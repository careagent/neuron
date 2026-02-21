import { Type, type Static } from '@sinclair/typebox'
import { UuidString, IsoDateString } from './common.js'

/** Cached chart entry schema */
export const CachedChartEntrySchema = Type.Object({
  entry_id: UuidString,
  relationship_id: UuidString,
  content_hash: Type.String(),
  content: Type.Record(Type.String(), Type.Unknown()),
  received_at: IsoDateString,
})

export type CachedChartEntry = Static<typeof CachedChartEntrySchema>

/** Sync state schema */
export const SyncStateSchema = Type.Object({
  relationship_id: UuidString,
  last_sync_at: IsoDateString,
  entry_count: Type.Number({ minimum: 0, default: 0 }),
})

export type SyncState = Static<typeof SyncStateSchema>
