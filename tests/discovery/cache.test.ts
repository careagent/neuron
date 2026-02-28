/**
 * Tests for TTL-based DNS record cache.
 *
 * Validates TTL-based expiry, goodbye (TTL=0) handling, cache-flush bit,
 * periodic cleanup, and 80% TTL re-announce detection.
 * Uses vi.useFakeTimers() for deterministic TTL testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RecordCache } from '../../src/discovery/cache.js'
import { encodeA, RECORD_TYPE, RECORD_CLASS, CACHE_FLUSH_BIT } from '../../src/discovery/dns-packet.js'
import type { DnsResourceRecord } from '../../src/discovery/dns-packet.js'

function makeARecord(name: string, ip: string, ttl: number, cacheFlush = false): DnsResourceRecord {
  return {
    name,
    type: RECORD_TYPE.A,
    class: cacheFlush ? (RECORD_CLASS.IN | CACHE_FLUSH_BIT) : RECORD_CLASS.IN,
    ttl,
    rdata: encodeA(ip),
  }
}

describe('RecordCache', () => {
  let cache: RecordCache
  let now: number

  beforeEach(() => {
    now = 1000000
    cache = new RecordCache(() => now)
  })

  afterEach(() => {
    cache.stopCleanup()
  })

  describe('put/get', () => {
    it('stores and retrieves a record', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 120)
      cache.put(rr)

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual(rr)
    })

    it('stores multiple records with different rdata under the same key', () => {
      const rr1 = makeARecord('test.local', '192.168.1.1', 120)
      const rr2 = makeARecord('test.local', '192.168.1.2', 120)
      cache.put(rr1)
      cache.put(rr2)

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(2)
    })

    it('updates TTL when same rdata is inserted again', () => {
      const rr1 = makeARecord('test.local', '192.168.1.1', 60)
      cache.put(rr1)

      // Advance time 30 seconds
      now += 30000

      const rr2 = makeARecord('test.local', '192.168.1.1', 120) // Higher TTL
      cache.put(rr2)

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(1)
      expect(results[0].ttl).toBe(120)
    })

    it('returns empty array for non-existent records', () => {
      const results = cache.get('nonexistent.local', RECORD_TYPE.A)
      expect(results).toEqual([])
    })
  })

  describe('TTL expiry', () => {
    it('evicts expired records on get', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 60) // 60 second TTL
      cache.put(rr)

      // Advance past TTL
      now += 61000

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toEqual([])
    })

    it('keeps records within TTL', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 120)
      cache.put(rr)

      // Advance to just under TTL
      now += 119000

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(1)
    })

    it('evicts some records while keeping others', () => {
      const rr1 = makeARecord('test.local', '192.168.1.1', 30) // Expires in 30s
      const rr2 = makeARecord('test.local', '192.168.1.2', 120) // Expires in 120s
      cache.put(rr1)
      cache.put(rr2)

      // Advance 60 seconds — rr1 expired, rr2 still valid
      now += 60000

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(1)
      expect(results[0].rdata).toEqual(rr2.rdata)
    })
  })

  describe('Goodbye (TTL=0)', () => {
    it('removes records immediately when TTL is 0', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 120)
      cache.put(rr)

      expect(cache.get('test.local', RECORD_TYPE.A)).toHaveLength(1)

      // Send goodbye
      const goodbye = makeARecord('test.local', '192.168.1.1', 0)
      cache.put(goodbye)

      expect(cache.get('test.local', RECORD_TYPE.A)).toEqual([])
    })

    it('removes all records of that name/type on goodbye', () => {
      cache.put(makeARecord('test.local', '192.168.1.1', 120))
      cache.put(makeARecord('test.local', '192.168.1.2', 120))

      expect(cache.get('test.local', RECORD_TYPE.A)).toHaveLength(2)

      // Goodbye removes all
      cache.put(makeARecord('test.local', '0.0.0.0', 0))

      expect(cache.get('test.local', RECORD_TYPE.A)).toEqual([])
    })
  })

  describe('Cache-flush bit', () => {
    it('replaces all records when cache-flush bit is set', () => {
      const rr1 = makeARecord('test.local', '192.168.1.1', 120)
      const rr2 = makeARecord('test.local', '192.168.1.2', 120)
      cache.put(rr1)
      cache.put(rr2)

      expect(cache.get('test.local', RECORD_TYPE.A)).toHaveLength(2)

      // Cache-flush replaces all records of this type
      const rrFlush = makeARecord('test.local', '10.0.0.1', 120, true)
      cache.put(rrFlush)

      const results = cache.get('test.local', RECORD_TYPE.A)
      expect(results).toHaveLength(1)
      expect(results[0].rdata).toEqual(rrFlush.rdata)
    })
  })

  describe('getAll', () => {
    it('returns all non-expired records', () => {
      cache.put(makeARecord('a.local', '1.1.1.1', 120))
      cache.put(makeARecord('b.local', '2.2.2.2', 120))

      const all = cache.getAll()
      expect(all).toHaveLength(2)
    })

    it('filters out expired records', () => {
      cache.put(makeARecord('expired.local', '1.1.1.1', 10))
      cache.put(makeARecord('valid.local', '2.2.2.2', 120))

      now += 15000 // 15s — first record expired

      const all = cache.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].name).toBe('valid.local')
    })
  })

  describe('getExpiringRecords', () => {
    it('returns records at 80% of their TTL', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 100)
      cache.put(rr)

      // At exactly 80 seconds (80% of 100s TTL)
      now += 80000

      const expiring = cache.getExpiringRecords()
      expect(expiring).toHaveLength(1)
    })

    it('does not return records before 80% of TTL', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 100)
      cache.put(rr)

      // At 70 seconds (70% of TTL)
      now += 70000

      const expiring = cache.getExpiringRecords()
      expect(expiring).toHaveLength(0)
    })

    it('does not return already expired records', () => {
      const rr = makeARecord('test.local', '192.168.1.1', 100)
      cache.put(rr)

      // Past TTL
      now += 110000

      const expiring = cache.getExpiringRecords()
      expect(expiring).toHaveLength(0)
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      cache.put(makeARecord('a.local', '1.1.1.1', 120))
      cache.put(makeARecord('b.local', '2.2.2.2', 120))
      expect(cache.size).toBe(2)

      cache.clear()
      expect(cache.size).toBe(0)
    })
  })

  describe('flush', () => {
    it('removes expired entries without needing get()', () => {
      cache.put(makeARecord('a.local', '1.1.1.1', 10))
      cache.put(makeARecord('b.local', '2.2.2.2', 120))
      expect(cache.size).toBe(2)

      now += 15000 // Expire first record
      cache.flush()

      expect(cache.size).toBe(1)
    })
  })

  describe('periodic cleanup', () => {
    it('starts and stops cleanup timer', () => {
      vi.useFakeTimers()

      const realCache = new RecordCache()
      realCache.startCleanup(1000)
      realCache.stopCleanup()

      vi.useRealTimers()
    })
  })

  describe('size', () => {
    it('reflects number of unique name+type+class combinations', () => {
      expect(cache.size).toBe(0)
      cache.put(makeARecord('a.local', '1.1.1.1', 120))
      expect(cache.size).toBe(1)
      cache.put(makeARecord('b.local', '2.2.2.2', 120))
      expect(cache.size).toBe(2)
      // Same key, different rdata
      cache.put(makeARecord('a.local', '3.3.3.3', 120))
      expect(cache.size).toBe(2) // Still 2 keys
    })
  })
})
