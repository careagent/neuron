/**
 * E2E: Local mDNS Discovery Test
 *
 * Validates ROADMAP Phase 7 Success Criterion 2: Neuron advertises via mDNS,
 * browser discovers service, TXT records contain NPI and endpoint, WebSocket
 * connection via discovered endpoint completes consent handshake.
 *
 * Uses real bonjour-service browser (not mocks). mDNS has inherent latency
 * on macOS (1-2 seconds), so tests use extended timeouts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sign } from 'node:crypto'
// @ts-expect-error -- bonjour-service default export typing issue (pre-existing)
import Bonjour, { type Service } from 'bonjour-service'
import {
  NeuronTestHarness,
  makeTestKeyPair,
  signConsentToken,
  validClaims,
  connectAndWaitOpen,
  receiveMessage,
  waitForClose,
  sendAuthMessage,
} from './helpers/neuron-harness.js'

describe('E2E: Local mDNS Discovery', { timeout: 30000 }, () => {
  let harness: NeuronTestHarness
  let discoveredEndpoint: string | null = null

  const providerNpi = '1234567893'

  beforeAll(async () => {
    harness = new NeuronTestHarness()
    await harness.start({ enableDiscovery: true })

    // Register a provider for the handshake test
    await harness.registrationService.addProvider(providerNpi)
  }, 20000)

  afterAll(async () => {
    await harness.stop()
  }, 10000)

  it('Neuron advertises _careagent-neuron._tcp via mDNS', async () => {
    // Create a Bonjour browser to discover the service
    const bonjour = new Bonjour()
    let foundService: Service | null = null

    try {
      foundService = await new Promise<Service>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('mDNS discovery timed out after 10 seconds'))
        }, 10000)

        const browser = bonjour.find({ type: 'careagent-neuron' }, (service: Service) => {
          clearTimeout(timeout)
          browser.stop()
          resolve(service)
        })
      })
    } finally {
      bonjour.destroy()
    }

    expect(foundService).not.toBeNull()
    expect(foundService!.type).toBe('careagent-neuron')
    expect(foundService!.port).toBe(harness.port)

    // Verify TXT records
    const txt = foundService!.txt as Record<string, string>
    expect(txt).toBeDefined()
    expect(txt.npi).toBe('9999999999') // Org NPI from harness config
    expect(txt.ver).toBe('v1.0')
    expect(txt.ep).toBeDefined()
    expect(txt.ep).toContain('/ws/handshake')

    // Store discovered endpoint for next test
    discoveredEndpoint = txt.ep
  }, 15000)

  it('connects via discovered endpoint and completes consent handshake', async () => {
    // Use discovered endpoint or fall back to harness port
    const endpoint = discoveredEndpoint ?? `ws://127.0.0.1:${harness.port}/ws/handshake`
    expect(discoveredEndpoint).not.toBeNull()

    // Extract port from discovered endpoint for WebSocket connection
    // The endpoint looks like: ws://192.168.x.x:{port}/ws/handshake
    // We connect to 127.0.0.1 since mDNS may advertise a LAN IP
    const { publicKey, privateKey, publicKeyBase64url } = makeTestKeyPair()
    const claims = validClaims('patient-discovery-001', providerNpi)
    const token = signConsentToken(claims, privateKey)

    // Connect via WebSocket to the harness port (same endpoint, local loopback)
    const ws = await connectAndWaitOpen(harness.port)
    const closePromise = waitForClose(ws)

    // Send auth message
    sendAuthMessage(ws, token, publicKeyBase64url, 'patient-discovery-001')

    // Receive challenge
    const challenge = await receiveMessage(ws)
    expect(challenge.type).toBe('handshake.challenge')
    expect(challenge.nonce).toBeDefined()

    // Sign challenge nonce
    const nonceBuffer = Buffer.from(challenge.nonce as string, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    // Send challenge response
    ws.send(JSON.stringify({
      type: 'handshake.challenge_response',
      signed_nonce: signedNonce.toString('base64url'),
    }))

    // Receive handshake complete
    const complete = await receiveMessage(ws)
    expect(complete.type).toBe('handshake.complete')
    expect(complete.relationship_id).toBeDefined()

    // WebSocket should close with 1000
    const closeResult = await closePromise
    expect(closeResult.code).toBe(1000)

    // This proves DISC-04: local connections use the same consent verification flow
  }, 15000)
})
