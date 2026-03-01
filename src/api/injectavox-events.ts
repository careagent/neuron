/**
 * InjectaVox event emitter — notifies provider agents when new data arrives.
 *
 * Uses Node.js EventEmitter for in-process notification. Provider agent
 * adapters can subscribe to 'visit_ingested' events to trigger processing.
 */

import { EventEmitter } from 'node:events'

/** Event payload emitted after successful ingestion */
export interface VisitIngestedEvent {
  visit_id: string
  provider_npi: string
  patient_id: string
  visit_type: string
  ingested_at: string
}

/**
 * Typed event emitter for InjectaVox ingestion events.
 */
export class InjectaVoxEventEmitter extends EventEmitter {
  /** Emit a visit_ingested event to notify provider agents */
  emitVisitIngested(event: VisitIngestedEvent): void {
    this.emit('visit_ingested', event)
  }

  /** Subscribe to visit_ingested events */
  onVisitIngested(handler: (event: VisitIngestedEvent) => void): this {
    return this.on('visit_ingested', handler)
  }
}
