/**
 * InjectaVox route handlers.
 *
 * POST /v1/injectavox/ingest  — Ingest a clinical visit from InjectaVox
 * GET  /v1/injectavox/visits/:provider_npi — List unprocessed visits for provider
 */

import type { ServerResponse } from 'node:http'
import { Value } from '@sinclair/typebox/value'
import { sendJson } from '../http-utils.js'
import { InjectaVoxPayloadSchema } from '../../types/injectavox.js'
import type { InjectaVoxStore } from '../injectavox-store.js'
import type { InjectaVoxEventEmitter } from '../injectavox-events.js'
import type { AuditLogger } from '../../audit/logger.js'

export interface InjectaVoxHandlerDeps {
  injectaVoxStore: InjectaVoxStore
  injectaVoxEvents: InjectaVoxEventEmitter
  auditLogger?: AuditLogger
}

/**
 * Handle POST /v1/injectavox/ingest
 *
 * Validates the payload against the InjectaVox schema, stores it,
 * logs to the audit trail, and emits a notification event.
 */
export function handleInjectaVoxIngest(
  res: ServerResponse,
  deps: InjectaVoxHandlerDeps,
  body: string,
): void {
  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  // Validate against schema
  if (!Value.Check(InjectaVoxPayloadSchema, parsed)) {
    const errors = [...Value.Errors(InjectaVoxPayloadSchema, parsed)]
    sendJson(res, 400, {
      error: 'Validation failed',
      details: errors.map((e) => ({ path: e.path, message: e.message })),
    })
    return
  }

  // Check for duplicate visit_id
  const existing = deps.injectaVoxStore.getById(parsed.visit_id)
  if (existing) {
    sendJson(res, 409, { error: 'Visit already ingested', visit_id: parsed.visit_id })
    return
  }

  // Store the visit
  const row = deps.injectaVoxStore.insert(parsed)

  // Audit log
  if (deps.auditLogger) {
    deps.auditLogger.append({
      category: 'ingestion',
      action: 'visit_ingested',
      details: {
        visit_id: parsed.visit_id,
        provider_npi: parsed.provider_npi,
        patient_id: parsed.patient_id,
        visit_type: parsed.visit_type,
      },
    })
  }

  // Notify provider agent
  deps.injectaVoxEvents.emitVisitIngested({
    visit_id: row.visit_id,
    provider_npi: row.provider_npi,
    patient_id: row.patient_id,
    visit_type: row.visit_type,
    ingested_at: row.ingested_at,
  })

  sendJson(res, 201, {
    visit_id: row.visit_id,
    provider_npi: row.provider_npi,
    patient_id: row.patient_id,
    ingested_at: row.ingested_at,
    status: 'ingested',
  })
}

/**
 * Handle GET /v1/injectavox/visits/:provider_npi
 *
 * Returns unprocessed visits for a provider NPI.
 * Query params: limit (default 50), offset (default 0)
 */
export function handleInjectaVoxVisits(
  res: ServerResponse,
  deps: InjectaVoxHandlerDeps,
  providerNpi: string,
  searchParams: URLSearchParams,
): void {
  // Validate NPI format
  if (!/^\d{10}$/.test(providerNpi)) {
    sendJson(res, 400, { error: 'Invalid provider NPI format' })
    return
  }

  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50),
    100,
  )
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0)

  const visits = deps.injectaVoxStore.listUnprocessed(providerNpi, limit, offset)
  const total = deps.injectaVoxStore.countUnprocessed(providerNpi)

  // Deserialize JSON fields for API response
  const data = visits.map((v) => ({
    visit_id: v.visit_id,
    provider_npi: v.provider_npi,
    patient_id: v.patient_id,
    visit_type: v.visit_type,
    visit_date: v.visit_date,
    chief_complaint: v.chief_complaint,
    clinical_notes: v.clinical_notes,
    vitals: v.vitals ? JSON.parse(v.vitals) : null,
    assessment: v.assessment,
    plan: v.plan,
    medications: v.medications ? JSON.parse(v.medications) : null,
    follow_up: v.follow_up ? JSON.parse(v.follow_up) : null,
    ingested_at: v.ingested_at,
  }))

  sendJson(res, 200, { data, total, limit, offset })
}
