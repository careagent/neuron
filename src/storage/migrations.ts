import type Database from 'better-sqlite3'

/**
 * A database migration with version number, description, and SQL to run.
 */
export interface Migration {
  version: number
  description: string
  up: string
}

/**
 * All registered migrations in version order.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create core tables: relationships, appointments, billing, termination, chart cache, sync state',
    up: `
      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );

      -- Relationships
      CREATE TABLE IF NOT EXISTS relationships (
        relationship_id TEXT PRIMARY KEY,
        patient_agent_id TEXT NOT NULL,
        provider_npi TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        consented_actions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relationships_patient ON relationships(patient_agent_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_provider ON relationships(provider_npi);
      CREATE INDEX IF NOT EXISTS idx_relationships_status ON relationships(status);

      -- Appointments
      CREATE TABLE IF NOT EXISTS appointments (
        appointment_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        provider_npi TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_appointments_relationship ON appointments(relationship_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(provider_npi);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);

      -- Billing records
      CREATE TABLE IF NOT EXISTS billing_records (
        billing_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        provider_npi TEXT NOT NULL,
        appointment_id TEXT,
        cpt_entries TEXT NOT NULL,
        icd10_codes TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        total_amount REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_relationship ON billing_records(relationship_id);
      CREATE INDEX IF NOT EXISTS idx_billing_status ON billing_records(status);

      -- Termination records
      CREATE TABLE IF NOT EXISTS termination_records (
        termination_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        provider_npi TEXT NOT NULL,
        reason TEXT NOT NULL,
        terminated_at TEXT NOT NULL,
        audit_entry_sequence INTEGER
      );

      -- Cached chart entries
      CREATE TABLE IF NOT EXISTS cached_chart_entries (
        entry_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chart_entries_relationship ON cached_chart_entries(relationship_id);

      -- Sync state
      CREATE TABLE IF NOT EXISTS sync_state (
        relationship_id TEXT PRIMARY KEY,
        last_sync_at TEXT NOT NULL,
        entry_count INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    description: 'Create registration tables: neuron_registration, provider_registrations',
    up: `
      CREATE TABLE IF NOT EXISTS neuron_registration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        organization_npi TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        organization_type TEXT NOT NULL,
        axon_registry_url TEXT NOT NULL,
        neuron_endpoint_url TEXT NOT NULL,
        registration_id TEXT,
        axon_bearer_token TEXT,
        status TEXT NOT NULL DEFAULT 'unregistered',
        first_registered_at TEXT,
        last_heartbeat_at TEXT,
        last_axon_response_at TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_registrations (
        provider_npi TEXT PRIMARY KEY,
        axon_provider_id TEXT,
        registration_status TEXT NOT NULL DEFAULT 'pending',
        first_registered_at TEXT,
        last_heartbeat_at TEXT,
        last_axon_response_at TEXT
      );
    `,
  },
  {
    version: 3,
    description: 'Add patient_public_key to relationships table',
    up: `ALTER TABLE relationships ADD COLUMN patient_public_key TEXT NOT NULL DEFAULT '';`,
  },
  {
    version: 4,
    description: 'Create api_keys table for REST API authentication',
    up: `
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `,
  },
  {
    version: 5,
    description: 'Add provider name, types, and specialty to provider_registrations',
    up: `
      ALTER TABLE provider_registrations ADD COLUMN provider_name TEXT;
      ALTER TABLE provider_registrations ADD COLUMN provider_types TEXT;
      ALTER TABLE provider_registrations ADD COLUMN specialty TEXT;
    `,
  },
  {
    version: 6,
    description: 'Create consent_relationships table for consent lifecycle tracking',
    up: `
      CREATE TABLE IF NOT EXISTS consent_relationships (
        id TEXT PRIMARY KEY,
        patient_public_key TEXT NOT NULL,
        provider_public_key TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        consent_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_consent_rel_patient
        ON consent_relationships(patient_public_key);
      CREATE INDEX IF NOT EXISTS idx_consent_rel_provider
        ON consent_relationships(provider_public_key);
      CREATE INDEX IF NOT EXISTS idx_consent_rel_status
        ON consent_relationships(status);
    `,
  },
  {
    version: 7,
    description: 'Create audit_log table for consent audit trail with hash chain and Ed25519 signatures',
    up: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        actor_public_key TEXT NOT NULL,
        details TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        signature TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_relationship
        ON audit_log(relationship_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_log(timestamp);
    `,
  },
]

/**
 * Run pending database migrations inside a transaction.
 *
 * Creates the schema_version table if it doesn't exist, reads the current
 * version, and applies any migrations with a higher version number.
 *
 * @param db - better-sqlite3 Database instance
 */
export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)

  // Get current version
  const row = db.prepare('SELECT MAX(version) as max_version FROM schema_version').get() as
    | { max_version: number | null }
    | undefined
  const currentVersion = row?.max_version ?? 0

  // Apply pending migrations
  const pending = migrations.filter((m) => m.version > currentVersion)
  if (pending.length === 0) return

  const applyMigrations = db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)').run(
        migration.version,
        new Date().toISOString(),
        migration.description,
      )
    }
  })

  applyMigrations()
}
