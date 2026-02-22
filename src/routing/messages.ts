import { Type, type Static } from '@sinclair/typebox'

/** Patient -> Neuron: Consent token submission (first message after connect) */
export const HandshakeAuthMessageSchema = Type.Object({
  type: Type.Literal('handshake.auth'),
  consent_token_payload: Type.String(),
  consent_token_signature: Type.String(),
  patient_agent_id: Type.String(),
  patient_public_key: Type.String(),
  patient_endpoint: Type.String(),
})
export type HandshakeAuthMessage = Static<typeof HandshakeAuthMessageSchema>

/** Neuron -> Patient: Challenge for identity verification */
export const HandshakeChallengeMessageSchema = Type.Object({
  type: Type.Literal('handshake.challenge'),
  nonce: Type.String(),
  provider_npi: Type.String(),
  organization_npi: Type.String(),
})
export type HandshakeChallengeMessage = Static<typeof HandshakeChallengeMessageSchema>

/** Patient -> Neuron: Challenge response with signed nonce */
export const HandshakeChallengeResponseMessageSchema = Type.Object({
  type: Type.Literal('handshake.challenge_response'),
  signed_nonce: Type.String(),
})
export type HandshakeChallengeResponseMessage = Static<typeof HandshakeChallengeResponseMessageSchema>

/** Neuron -> Patient: Handshake complete with address exchange */
export const HandshakeCompleteMessageSchema = Type.Object({
  type: Type.Literal('handshake.complete'),
  relationship_id: Type.String(),
  provider_endpoint: Type.String(),
  status: Type.Union([
    Type.Literal('new'),
    Type.Literal('existing'),
  ]),
})
export type HandshakeCompleteMessage = Static<typeof HandshakeCompleteMessageSchema>

/** Neuron -> Patient: Error response */
export const HandshakeErrorMessageSchema = Type.Object({
  type: Type.Literal('handshake.error'),
  code: Type.String(),
  message: Type.String(),
})
export type HandshakeErrorMessage = Static<typeof HandshakeErrorMessageSchema>

/** Union of all inbound messages (patient -> neuron) */
export const InboundHandshakeMessageSchema = Type.Union([
  HandshakeAuthMessageSchema,
  HandshakeChallengeResponseMessageSchema,
])
export type InboundHandshakeMessage = Static<typeof InboundHandshakeMessageSchema>
