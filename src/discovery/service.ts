/**
 * DiscoveryService: mDNS/DNS-SD advertisement for local network CareAgent discovery.
 *
 * Wraps bonjour-service to advertise a `_careagent-neuron._tcp` service
 * with TXT records containing organization NPI, protocol version, and
 * connection endpoint. Handles graceful shutdown with goodbye packets.
 *
 * TXT record keys follow RFC 6763 Section 6.4 (<=9 chars):
 *   npi — Organization NPI (10 digits)
 *   ver — Protocol version (semantic, e.g., v1.0)
 *   ep  — Full WebSocket endpoint URL
 */

import Bonjour, { type Service } from 'bonjour-service'
import type { DiscoveryConfig } from './types.js'

export class DiscoveryService {
  private bonjour: InstanceType<typeof Bonjour> | null = null
  private service: Service | null = null

  constructor(private readonly config: DiscoveryConfig) {}

  /**
   * Start mDNS advertisement if enabled.
   * No-op when config.enabled is false (DISC-03).
   */
  async start(): Promise<void> {
    if (!this.config.enabled) return

    this.bonjour = new Bonjour()
    this.service = this.bonjour.publish({
      name: `neuron-${this.config.organizationNpi}`,
      type: this.config.serviceType,
      port: this.config.serverPort,
      txt: {
        npi: this.config.organizationNpi,
        ver: this.config.protocolVersion,
        ep: this.config.endpointUrl,
      },
    })
  }

  /**
   * Stop mDNS advertisement and send goodbye packets.
   * Safe to call even if start() was never called or service is disabled.
   */
  async stop(): Promise<void> {
    if (!this.bonjour) return

    return new Promise<void>((resolve) => {
      this.bonjour!.unpublishAll(() => {
        this.bonjour!.destroy()
        this.bonjour = null
        this.service = null
        resolve()
      })
    })
  }
}
