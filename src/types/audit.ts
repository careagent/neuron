import { Type, type Static } from '@sinclair/typebox'
import { IsoDateString } from './common.js'

/** Audit event category */
export const AuditCategorySchema = Type.Union([
  Type.Literal('registration'),
  Type.Literal('connection'),
  Type.Literal('consent'),
  Type.Literal('api_access'),
  Type.Literal('sync'),
  Type.Literal('admin'),
  Type.Literal('termination'),
  Type.Literal('ingestion'),
])

export type AuditCategory = Static<typeof AuditCategorySchema>

/** Audit log entry schema */
export const AuditEntrySchema = Type.Object({
  sequence: Type.Number(),
  timestamp: IsoDateString,
  category: AuditCategorySchema,
  action: Type.String(),
  actor: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  prev_hash: Type.String(),
  hash: Type.String(),
})

export type AuditEntry = Static<typeof AuditEntrySchema>
