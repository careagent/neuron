import { Type, type Static } from '@sinclair/typebox'

/** IPC command schema — discriminated union of all supported commands. */
export const IpcCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal('provider.add'), npi: Type.String() }),
  Type.Object({ type: Type.Literal('provider.remove'), npi: Type.String() }),
  Type.Object({ type: Type.Literal('provider.list') }),
  Type.Object({ type: Type.Literal('status') }),
  Type.Object({
    type: Type.Literal('relationship.terminate'),
    relationship_id: Type.String(),
    provider_npi: Type.String(),
    reason: Type.String(),
  }),
])

export type IpcCommand = Static<typeof IpcCommandSchema>

/** IPC response schema — every command returns ok + optional data or error. */
export const IpcResponseSchema = Type.Object({
  ok: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
})

export type IpcResponse = Static<typeof IpcResponseSchema>
