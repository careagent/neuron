/**
 * GET /v1/consent/status/:relationship_id -- get consent relationship status.
 *
 * Looks up a relationship by ID and returns its consent status.
 * Checks both the main relationship store and the consent relationship store.
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'
import type { ApiRouterDeps } from '../router.js'

export function handleConsentStatus(
  res: ServerResponse,
  deps: ApiRouterDeps,
  relationshipId: string,
): void {
  // Check the main relationship store first
  const relationship = deps.relationshipStore.findById(relationshipId)

  if (relationship) {
    sendJson(res, 200, {
      relationship_id: relationship.relationship_id,
      status: relationship.status,
      patient_agent_id: relationship.patient_agent_id,
      provider_npi: relationship.provider_npi,
      consented_actions: relationship.consented_actions,
      created_at: relationship.created_at,
      updated_at: relationship.updated_at,
    })
    return
  }

  // Check the consent relationship store (from consent broker)
  if (deps.consentRelationshipStore) {
    const consentRel = deps.consentRelationshipStore.getById(relationshipId)
    if (consentRel) {
      sendJson(res, 200, {
        relationship_id: consentRel.id,
        status: consentRel.status,
        scope: consentRel.scope,
        created_at: consentRel.createdAt,
        updated_at: consentRel.updatedAt,
        expires_at: consentRel.expiresAt,
      })
      return
    }
  }

  sendJson(res, 404, { error: 'Relationship not found' })
}
