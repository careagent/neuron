/**
 * TDD tests for DiscoveryService — mDNS/DNS-SD advertisement lifecycle.
 *
 * Mocks bonjour-service at module level to verify publish/unpublish/destroy
 * calls without actual network activity.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockPublish = vi.fn()
const mockUnpublishAll = vi.fn((cb: () => void) => cb())
const mockDestroy = vi.fn()

vi.mock('bonjour-service', () => ({
  default: vi.fn().mockImplementation(() => ({
    publish: mockPublish,
    unpublishAll: mockUnpublishAll,
    destroy: mockDestroy,
  })),
}))

import Bonjour from 'bonjour-service'
import { DiscoveryService } from './service.js'
import type { DiscoveryConfig } from './types.js'

describe('DiscoveryService', () => {
  const defaultConfig: DiscoveryConfig = {
    enabled: true,
    serviceType: 'careagent-neuron',
    protocolVersion: 'v1.0',
    organizationNpi: '1234567893',
    serverPort: 3000,
    endpointUrl: 'ws://192.168.1.5:3000/ws/handshake',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('start()', () => {
    it('publishes service with correct type and port when enabled', async () => {
      const service = new DiscoveryService(defaultConfig)
      await service.start()

      expect(Bonjour).toHaveBeenCalledOnce()
      expect(mockPublish).toHaveBeenCalledOnce()
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'careagent-neuron',
          port: 3000,
        }),
      )
    })

    it('sets correct TXT records with npi, ver, and ep', async () => {
      const service = new DiscoveryService(defaultConfig)
      await service.start()

      const publishCall = mockPublish.mock.calls[0][0]
      expect(publishCall.txt).toEqual({
        npi: '1234567893',
        ver: 'v1.0',
        ep: 'ws://192.168.1.5:3000/ws/handshake',
      })
    })

    it('is a no-op when disabled', async () => {
      const service = new DiscoveryService({ ...defaultConfig, enabled: false })
      await service.start()

      expect(Bonjour).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('uses NPI in service instance name for uniqueness', async () => {
      const service = new DiscoveryService(defaultConfig)
      await service.start()

      const publishCall = mockPublish.mock.calls[0][0]
      expect(publishCall.name).toBe('neuron-1234567893')
    })

    it('uses NPI from different organizations', async () => {
      const service = new DiscoveryService({
        ...defaultConfig,
        organizationNpi: '9876543210',
      })
      await service.start()

      const publishCall = mockPublish.mock.calls[0][0]
      expect(publishCall.name).toBe('neuron-9876543210')
    })
  })

  describe('stop()', () => {
    it('calls unpublishAll then destroy', async () => {
      const service = new DiscoveryService(defaultConfig)
      await service.start()

      await service.stop()

      expect(mockUnpublishAll).toHaveBeenCalledOnce()
      expect(mockDestroy).toHaveBeenCalledOnce()
    })

    it('is safe when never started', async () => {
      const service = new DiscoveryService(defaultConfig)

      // Should not throw
      await expect(service.stop()).resolves.toBeUndefined()
      expect(mockUnpublishAll).not.toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('is safe when disabled (never started)', async () => {
      const service = new DiscoveryService({ ...defaultConfig, enabled: false })
      await service.start() // no-op
      await expect(service.stop()).resolves.toBeUndefined()
    })
  })

  describe('RFC 6763 compliance', () => {
    it('TXT record keys are all 9 characters or fewer', async () => {
      const service = new DiscoveryService(defaultConfig)
      await service.start()

      const publishCall = mockPublish.mock.calls[0][0]
      const txtKeys = Object.keys(publishCall.txt)

      for (const key of txtKeys) {
        expect(key.length).toBeLessThanOrEqual(9)
      }
    })
  })
})
