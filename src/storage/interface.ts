/**
 * Result from a SQL write operation.
 */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * Thin storage engine abstraction.
 *
 * Provides raw SQL access via prepare/run/get/all with transaction support.
 * Implementations should handle connection lifecycle and migrations.
 */
export interface StorageEngine {
  /** Run migrations and set up tables. */
  initialize(): void

  /** Close the database connection. */
  close(): void

  /** Execute a write SQL statement. Returns changes count and last insert rowid. */
  run(sql: string, params?: unknown[]): RunResult

  /** Execute a read SQL statement. Returns a single row or undefined. */
  get<T>(sql: string, params?: unknown[]): T | undefined

  /** Execute a read SQL statement. Returns all matching rows. */
  all<T>(sql: string, params?: unknown[]): T[]

  /** Execute a function inside a database transaction. Rolls back on error. */
  transaction<T>(fn: () => T): T
}
