/**
 * GET /v1/relationships — paginated relationship list.
 * GET /v1/relationships/:id — single relationship by ID.
 *
 * Excludes patient_public_key from responses (internal field).
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'
import type { ApiRouterDeps } from '../router.js'
import type { RelationshipRecord } from '../../types/relationship.js'

/** Map a relationship record to the API response shape (exclude internal fields) */
function mapRelationship(record: RelationshipRecord) {
  return {
    relationship_id: record.relationship_id,
    patient_agent_id: record.patient_agent_id,
    provider_npi: record.provider_npi,
    status: record.status,
    consented_actions: record.consented_actions,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }
}

export function handleRelationships(
  res: ServerResponse,
  deps: ApiRouterDeps,
  searchParams: URLSearchParams,
): void {
  const { relationshipStore } = deps

  const statusFilter = searchParams.get('status')
  const providerNpiFilter = searchParams.get('provider_npi')
  const offsetParam = searchParams.get('offset')
  const limitParam = searchParams.get('limit')

  const offset = offsetParam ? Math.max(0, Number(offsetParam)) : 0
  const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : 50

  let records: RelationshipRecord[]

  if (statusFilter) {
    records = relationshipStore.findByStatus(statusFilter)
  } else if (providerNpiFilter) {
    records = relationshipStore.findByProvider(providerNpiFilter)
  } else {
    // Query all relationships via storage (RelationshipStore doesn't have findAll)
    records = deps.storage.all<{
      relationship_id: string
      patient_agent_id: string
      provider_npi: string
      status: string
      consented_actions: string
      patient_public_key: string
      created_at: string
      updated_at: string
    }>('SELECT * FROM relationships ORDER BY created_at DESC').map((row) => ({
      relationship_id: row.relationship_id,
      patient_agent_id: row.patient_agent_id,
      provider_npi: row.provider_npi,
      status: row.status as RelationshipRecord['status'],
      consented_actions: JSON.parse(row.consented_actions) as string[],
      patient_public_key: row.patient_public_key,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  const total = records.length
  const paginated = records.slice(offset, offset + limit)

  sendJson(res, 200, {
    data: paginated.map(mapRelationship),
    total,
    offset,
    limit,
  })
}

export function handleRelationshipById(
  res: ServerResponse,
  deps: ApiRouterDeps,
  id: string,
): void {
  const record = deps.relationshipStore.findById(id)

  if (!record) {
    sendJson(res, 404, { error: 'Relationship not found' })
    return
  }

  sendJson(res, 200, mapRelationship(record))
}
