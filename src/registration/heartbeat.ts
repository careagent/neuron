/**
 * Heartbeat loop with exponential backoff and health metric file writer.
 *
 * Sends periodic endpoint updates to Axon to maintain reachable status.
 * On failure, enters exponential backoff with full jitter. On recovery,
 * resets to healthy interval. Writes neuron.health.json on status changes
 * and successful heartbeats for external monitoring.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AxonClient } from './axon-client.js'
import type { RegistrationStateStore } from './state.js'

/** Fixed heartbeat interval -- 60 seconds (locked decision: not configurable). */
export const HEARTBEAT_INTERVAL_MS = 60_000

/**
 * Write a machine-readable neuron.health.json to the data directory.
 *
 * This file can be polled by external monitoring systems (e.g. Prometheus
 * node exporter, custom health checks).
 */
export function writeHealthFile(
  dataDir: string,
  status: 'healthy' | 'degraded',
  lastHeartbeat?: string,
): void {
  const healthData = {
    status,
    last_heartbeat_at: lastHeartbeat ?? null,
    updated_at: new Date().toISOString(),
  }
  writeFileSync(
    join(dataDir, 'neuron.health.json'),
    JSON.stringify(healthData, null, 2) + '\n',
  )
}

export class HeartbeatManager {
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private isRunning = false
  private currentStatus: 'healthy' | 'degraded' = 'healthy'

  constructor(
    private readonly client: AxonClient,
    private readonly stateStore: RegistrationStateStore,
    private readonly backoffCeilingMs: number,
    private readonly onStatusChange?: (status: 'healthy' | 'degraded') => void,
    private readonly onRegistrationLost?: () => void,
  ) {}

  /** Start the heartbeat loop. First beat fires after HEARTBEAT_INTERVAL_MS. */
  start(): void {
    this.isRunning = true
    this.scheduleNext(HEARTBEAT_INTERVAL_MS)
  }

  /** Stop the heartbeat loop and clear any pending timeout. */
  stop(): void {
    this.isRunning = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Return current heartbeat status based on attempt counter. */
  getStatus(): 'healthy' | 'degraded' {
    return this.attempt === 0 ? 'healthy' : 'degraded'
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.beat()
    }, delayMs)
  }

  private async beat(): Promise<void> {
    if (!this.isRunning) return

    const state = this.stateStore.load()
    if (!state || state.status !== 'registered' || !state.registration_id) {
      this.scheduleNext(HEARTBEAT_INTERVAL_MS)
      return
    }

    try {
      await this.client.updateEndpoint(state.registration_id, {
        neuron_endpoint_url: state.neuron_endpoint_url,
      })

      // Success: reset backoff
      const wasDegrade = this.attempt > 0
      this.attempt = 0
      const timestamp = new Date().toISOString()
      this.stateStore.updateHeartbeat(timestamp)

      if (wasDegrade) {
        this.currentStatus = 'healthy'
        this.onStatusChange?.('healthy')
      }

      // Always fire status change on successful heartbeat to update health file timestamp
      if (!wasDegrade) {
        this.onStatusChange?.('healthy')
      }

      this.scheduleNext(HEARTBEAT_INTERVAL_MS)
    } catch (err) {
      // Check for 404 -- registration lost, trigger re-registration
      if (
        err instanceof Error &&
        'statusCode' in err &&
        (err as { statusCode: number }).statusCode === 404
      ) {
        this.onRegistrationLost?.()
      }

      this.attempt++
      const backoffMs = Math.min(
        this.backoffCeilingMs,
        Math.pow(2, this.attempt) * 5000 * Math.random(),
      )

      // Transition to degraded on first failure
      if (this.attempt === 1) {
        this.currentStatus = 'degraded'
        this.onStatusChange?.('degraded')
      }

      this.scheduleNext(backoffMs)
    }
  }
}
