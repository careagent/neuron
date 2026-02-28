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
