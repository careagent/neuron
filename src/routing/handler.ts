/**
 * WebSocket connection handler for the consent handshake flow.
 *
 * Orchestrates the multi-step handshake protocol as a state machine:
 * 1. Connection established -> start auth timeout
 * 2. First message (handshake.auth) -> verify consent token, check existing relationship, send challenge
 * 3. Second message (handshake.challenge_response) -> verify challenge, create relationship, send complete
 * 4. Close connection (broker-and-step-out model)
 *
 * Error handling maps consent errors to handshake error codes.
 * Binary frames are rejected (text-only JSON envelopes).
 */

import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { Value } from '@sinclair/typebox/value'
import type { NeuronConfig } from '../types/config.js'
import type { ConsentHandshakeHandler } from '../relationships/handshake.js'
import type { RelationshipStore } from '../relationships/store.js'
import type { AuditLogger } from '../audit/logger.js'
import { HandshakeSessionManager, type InternalSession } from './session.js'
import {
  HandshakeAuthMessageSchema,
  HandshakeChallengeResponseMessageSchema,
  type HandshakeAuthMessage,
  type HandshakeChallengeMessage,
  type HandshakeCompleteMessage,
  type HandshakeErrorMessage,
} from './messages.js'
import { verifyConsentToken, importPublicKey } from '../consent/verifier.js'
import { ConsentError } from '../consent/errors.js'
import type { RoutingErrorCode } from './errors.js'

/** Dependencies for the connection handler factory */
export interface HandlerDeps {
  config: NeuronConfig
  handshakeHandler: ConsentHandshakeHandler
  relationshipStore: RelationshipStore
  sessionManager: HandshakeSessionManager
  organizationNpi: string
  neuronEndpointUrl: string
  auditLogger?: AuditLogger
  /** Called when a session ends (completes, fails, disconnects) to process pending upgrades */
  onSessionEnd?: () => void
}

/**
 * Create a connection handler function for the WebSocket server.
 *
 * Returns a function that handles each new WebSocket connection,
 * orchestrating the full consent handshake flow.
 */
export function createConnectionHandler(deps: HandlerDeps): (ws: WebSocket, request: IncomingMessage) => void {
  const {
    config,
    handshakeHandler,
    relationshipStore,
    sessionManager,
    organizationNpi,
    neuronEndpointUrl,
    auditLogger,
    onSessionEnd,
  } = deps

  return (ws: WebSocket, _request: IncomingMessage): void => {
    // Create session (status: 'authenticating')
    const session = sessionManager.create()

    let authTimer: ReturnType<typeof setTimeout> | null = null

    // Cleanup helper: clear timer, remove session, notify server
    const cleanup = (): void => {
      if (authTimer) {
        clearTimeout(authTimer)
        authTimer = null
      }
      sessionManager.remove(session.id)
      if (onSessionEnd) {
        onSessionEnd()
      }
    }

    // Start auth timeout
    authTimer = setTimeout(() => {
      authTimer = null
      session.status = 'failed'
      sendError(ws, 'AUTH_TIMEOUT', 'No consent token received within timeout')
      ws.close(4001, 'Auth timeout')

      if (auditLogger) {
        auditLogger.append({
          category: 'connection',
          action: 'connection.timeout',
          details: { session_id: session.id },
        })
      }
    }, config.websocket.authTimeoutMs)

    // Handle WebSocket errors
    ws.on('error', () => {
      cleanup()
    })

    // Handle connection close
    ws.on('close', () => {
      cleanup()
    })

    // Wait for first message (handshake.auth)
    ws.once('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      // Clear auth timeout
      if (authTimer) {
        clearTimeout(authTimer)
        authTimer = null
      }

      // Reject binary frames (text frames only)
      if (isBinary) {
        session.status = 'failed'
        sendError(ws, 'INVALID_MESSAGE', 'Binary frames are not supported. Use text frames with JSON.')
        ws.close(4002, 'Binary not supported')
        return
      }

      handleAuthMessage(ws, session, data.toString())
    })

    /**
     * Handle the first message: handshake.auth
     */
    function handleAuthMessage(ws: WebSocket, session: InternalSession, raw: string): void {
      // Parse JSON
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        session.status = 'failed'
        sendError(ws, 'INVALID_MESSAGE', 'Message is not valid JSON')
        ws.close(4002, 'Invalid JSON')
        return
      }

      // Validate against HandshakeAuthMessageSchema
      if (!Value.Check(HandshakeAuthMessageSchema, parsed)) {
        session.status = 'failed'
        sendError(ws, 'INVALID_MESSAGE', 'Invalid handshake.auth message format')
        ws.close(4002, 'Invalid message')
        return
      }

      const authMsg = parsed as HandshakeAuthMessage

      // Update session with patient info
      session.patientAgentId = authMsg.patient_agent_id

      if (auditLogger) {
        auditLogger.append({
          category: 'connection',
          action: 'connection.handshake_started',
          actor: authMsg.patient_agent_id,
          details: { session_id: session.id },
        })
      }

      // Early consent token verification to extract provider_npi
      // (Stateless re-verify per CSNT-02; no side effects)
      let providerNpi: string
      try {
        const publicKey = importPublicKey(authMsg.patient_public_key)
        const claims = verifyConsentToken(
          {
            payload: Buffer.from(authMsg.consent_token_payload, 'base64url'),
            signature: Buffer.from(authMsg.consent_token_signature, 'base64url'),
          },
          publicKey,
        )
        providerNpi = claims.provider_npi
      } catch (err) {
        session.status = 'failed'
        if (err instanceof ConsentError) {
          sendError(ws, mapConsentErrorCode(err.code), err.message)
        } else {
          sendError(ws, 'SERVER_ERROR', 'Internal server error')
        }
        ws.close(4003, 'Consent verification failed')
        return
      }

      session.providerNpi = providerNpi

      // Check for existing active relationship
      const existingRelationships = relationshipStore.findByPatient(authMsg.patient_agent_id)
      const existingActive = existingRelationships.find(
        (r) => r.provider_npi === providerNpi && r.status === 'active',
      )

      if (existingActive) {
        // Skip challenge-response, return existing relationship
        session.status = 'completed'
        const providerEndpoint = `${neuronEndpointUrl}/ws/provider/${providerNpi}`
        const completeMsg: HandshakeCompleteMessage = {
          type: 'handshake.complete',
          relationship_id: existingActive.relationship_id,
          provider_endpoint: providerEndpoint,
          status: 'existing',
        }
        sendMessage(ws, completeMsg)
        ws.close(1000, 'Handshake complete')

        if (auditLogger) {
          auditLogger.append({
            category: 'connection',
            action: 'connection.handshake_completed',
            actor: authMsg.patient_agent_id,
            details: {
              session_id: session.id,
              relationship_id: existingActive.relationship_id,
              status: 'existing',
              provider_npi: providerNpi,
            },
          })
        }
        return
      }

      // No existing relationship -- start challenge-response flow
      let challenge: ReturnType<typeof handshakeHandler.startHandshake>
      try {
        challenge = handshakeHandler.startHandshake({
          patient_agent_id: authMsg.patient_agent_id,
          provider_npi: providerNpi,
          patient_public_key: authMsg.patient_public_key,
        })
      } catch (err) {
        session.status = 'failed'
        sendError(ws, 'SERVER_ERROR', err instanceof Error ? err.message : 'Failed to start handshake')
        ws.close(4003, 'Handshake start failed')
        return
      }

      // Send challenge
      session.status = 'challenged'
      const challengeMsg: HandshakeChallengeMessage = {
        type: 'handshake.challenge',
        nonce: challenge.nonce,
        provider_npi: challenge.provider_npi,
        organization_npi: challenge.organization_npi,
      }
      sendMessage(ws, challengeMsg)

      // Wait for second message (handshake.challenge_response)
      ws.once('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        // Reject binary frames
        if (isBinary) {
          session.status = 'failed'
          sendError(ws, 'INVALID_MESSAGE', 'Binary frames are not supported. Use text frames with JSON.')
          ws.close(4002, 'Binary not supported')
          return
        }

        handleChallengeResponse(ws, session, data.toString(), challenge.nonce, authMsg)
      })
    }

    /**
     * Handle the second message: handshake.challenge_response
     */
    function handleChallengeResponse(
      ws: WebSocket,
      session: InternalSession,
      raw: string,
      nonce: string,
      authMsg: HandshakeAuthMessage,
    ): void {
      // Parse JSON
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        session.status = 'failed'
        sendError(ws, 'INVALID_MESSAGE', 'Message is not valid JSON')
        ws.close(4002, 'Invalid JSON')
        return
      }

      // Validate against HandshakeChallengeResponseMessageSchema
      if (!Value.Check(HandshakeChallengeResponseMessageSchema, parsed)) {
        session.status = 'failed'
        sendError(ws, 'INVALID_MESSAGE', 'Invalid handshake.challenge_response message format')
        ws.close(4002, 'Invalid message')
        return
      }

      const responseMsg = parsed as { type: 'handshake.challenge_response'; signed_nonce: string }

      // Build ChallengeResponse for ConsentHandshakeHandler.completeHandshake
      try {
        const relationshipId = handshakeHandler.completeHandshake(nonce, {
          signed_nonce: responseMsg.signed_nonce,
          consent_token_payload: authMsg.consent_token_payload,
          consent_token_signature: authMsg.consent_token_signature,
        })

        // Success -- send handshake.complete
        session.status = 'completed'
        const providerEndpoint = `${neuronEndpointUrl}/ws/provider/${session.providerNpi}`
        const completeMsg: HandshakeCompleteMessage = {
          type: 'handshake.complete',
          relationship_id: relationshipId,
          provider_endpoint: providerEndpoint,
          status: 'new',
        }
        sendMessage(ws, completeMsg)
        ws.close(1000, 'Handshake complete')

        if (auditLogger) {
          auditLogger.append({
            category: 'connection',
            action: 'connection.handshake_completed',
            actor: authMsg.patient_agent_id,
            details: {
              session_id: session.id,
              relationship_id: relationshipId,
              status: 'new',
              provider_npi: session.providerNpi,
            },
          })
        }
      } catch (err) {
        session.status = 'failed'

        if (err instanceof ConsentError) {
          sendError(ws, mapConsentErrorCode(err.code), err.message)
        } else {
          sendError(ws, 'SERVER_ERROR', 'Internal server error')
        }
        ws.close(4003, 'Handshake failed')

        if (auditLogger) {
          auditLogger.append({
            category: 'connection',
            action: 'connection.handshake_failed',
            actor: authMsg.patient_agent_id,
            details: {
              session_id: session.id,
              error: err instanceof Error ? err.message : 'Unknown error',
              provider_npi: session.providerNpi,
            },
          })
        }
      }
    }
  }
}

/**
 * Send a JSON message over the WebSocket.
 */
function sendMessage(ws: WebSocket, message: Record<string, unknown>): void {
  ws.send(JSON.stringify(message))
}

/**
 * Send a handshake.error message and prepare for close.
 */
function sendError(ws: WebSocket, code: RoutingErrorCode, message: string): void {
  const errorMsg: HandshakeErrorMessage = {
    type: 'handshake.error',
    code,
    message,
  }
  ws.send(JSON.stringify(errorMsg))
}

/**
 * Map ConsentError codes to RoutingErrorCode.
 */
function mapConsentErrorCode(code: string): RoutingErrorCode {
  switch (code) {
    case 'INVALID_SIGNATURE':
      return 'CONSENT_FAILED'
    case 'CONSENT_EXPIRED':
      return 'CONSENT_FAILED'
    case 'MALFORMED_TOKEN':
      return 'INVALID_MESSAGE'
    default:
      return 'SERVER_ERROR'
  }
}
