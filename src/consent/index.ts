export { ConsentError, type ConsentErrorCode } from './errors.js'
export type { ConsentToken, ConsentClaims } from './token.js'
export { verifyConsentToken, importPublicKey } from './verifier.js'
export { generateChallenge, verifyChallenge } from './challenge.js'
export {
  ConsentRelationshipSchema,
  ConsentRelationshipStatus,
  ConsentRelationshipUpdateSchema,
  VALID_TRANSITIONS,
  validateTransition,
} from './relationship-schemas.js'
export type {
  ConsentRelationship,
  ConsentRelationshipUpdate,
} from './relationship-schemas.js'
export { ConsentRelationshipStore } from './relationship-store.js'
export {
  ConsentAuditActionSchema,
  ConsentAuditEntrySchema,
} from './audit-schemas.js'
export type {
  ConsentAuditAction,
  ConsentAuditEntry,
} from './audit-schemas.js'
export { ConsentAuditLog, computeAuditHash } from './audit-log.js'
export { ConsentBroker } from './broker.js'
export type {
  ConsentRequestMessage,
  ConsentChallengeMessage,
  ConsentChallengeResponseMessage,
  ConsentCompleteMessage,
  ConsentErrorMessage,
} from './broker.js'
