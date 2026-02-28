/**
 * TTL-based DNS record cache for mDNS/DNS-SD.
 *
 * Caches received service records with TTL-based expiry. Records are evicted
 * when their TTL expires. Supports TTL=0 (goodbye) for immediate removal
 * per RFC 6762 Section 10.1.
 */

import type { DnsResourceRecord } from './dns-packet.js'

/** A cached record with absolute expiry time */
export interface CachedRecord {
  record: DnsResourceRecord
  /** Absolute timestamp (ms) when this record expires */
  expiresAt: number
  /** Absolute timestamp (ms) when this record was cached */
  cachedAt: number
}

/** Cache key combining name + type + class for uniqueness */
function cacheKey(name: string, type: number, cls: number): string {
  return `${name}:${type}:${cls}`
}

/**
 * TTL-based DNS record cache.
 *
 * Records are stored with their expiry time and automatically removed on access
 * when expired. Also supports periodic flush of expired entries.
 */
export class RecordCache {
  private readonly entries = new Map<string, CachedRecord[]>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly getNow: () => number = Date.now,
  ) {}

  /**
   * Insert or update a record in the cache.
   * TTL=0 is a goodbye — removes the record immediately (RFC 6762 Section 10.1).
   */
  put(record: DnsResourceRecord): void {
    const key = cacheKey(record.name, record.type, record.class & 0x7fff) // mask cache-flush bit

    if (record.ttl === 0) {
      // Goodbye packet — remove matching records
      this.entries.delete(key)
      return
    }

    const now = this.getNow()
    const cached: CachedRecord = {
      record,
      expiresAt: now + record.ttl * 1000,
      cachedAt: now,
    }

    const existing = this.entries.get(key)
    if (existing) {
      // Check for cache-flush bit (RFC 6762 Section 10.2)
      if (record.class & 0x8000) {
        // Cache-flush: replace all records of this type/name
        this.entries.set(key, [cached])
      } else {
        // Check if same rdata exists; update TTL if so, otherwise append
        const idx = existing.findIndex((e) => e.record.rdata.equals(record.rdata))
        if (idx >= 0) {
          existing[idx] = cached
        } else {
          existing.push(cached)
        }
      }
    } else {
      this.entries.set(key, [cached])
    }
  }

  /**
   * Get all non-expired records matching a name and type.
   * Automatically evicts expired entries on access.
   */
  get(name: string, type: number, cls: number = 1): DnsResourceRecord[] {
    const key = cacheKey(name, type, cls)
    const entries = this.entries.get(key)
    if (!entries) return []

    const now = this.getNow()
    const valid = entries.filter((e) => e.expiresAt > now)

    if (valid.length === 0) {
      this.entries.delete(key)
      return []
    }

    if (valid.length !== entries.length) {
      this.entries.set(key, valid)
    }

    return valid.map((e) => e.record)
  }

  /**
   * Get all non-expired cached records (across all keys).
   */
  getAll(): DnsResourceRecord[] {
    const now = this.getNow()
    const results: DnsResourceRecord[] = []

    for (const [key, entries] of this.entries) {
      const valid = entries.filter((e) => e.expiresAt > now)
      if (valid.length === 0) {
        this.entries.delete(key)
      } else {
        if (valid.length !== entries.length) {
          this.entries.set(key, valid)
        }
        results.push(...valid.map((e) => e.record))
      }
    }

    return results
  }

  /**
   * Get records approaching expiry (at 80% of TTL — re-announce trigger).
   * Per RFC 6762 Section 5.2, records should be refreshed at 80% of TTL.
   */
  getExpiringRecords(): DnsResourceRecord[] {
    const now = this.getNow()
    const results: DnsResourceRecord[] = []

    for (const entries of this.entries.values()) {
      for (const entry of entries) {
        const totalTtl = entry.expiresAt - entry.cachedAt
        const elapsed = now - entry.cachedAt
        // At or past 80% of TTL
        if (elapsed >= totalTtl * 0.8 && entry.expiresAt > now) {
          results.push(entry.record)
        }
      }
    }

    return results
  }

  /** Remove all entries from the cache */
  clear(): void {
    this.entries.clear()
  }

  /** Flush expired entries from the cache */
  flush(): void {
    const now = this.getNow()
    for (const [key, entries] of this.entries) {
      const valid = entries.filter((e) => e.expiresAt > now)
      if (valid.length === 0) {
        this.entries.delete(key)
      } else if (valid.length !== entries.length) {
        this.entries.set(key, valid)
      }
    }
  }

  /** Start periodic cleanup of expired entries */
  startCleanup(intervalMs: number = 60000): void {
    this.stopCleanup()
    this.cleanupTimer = setInterval(() => this.flush(), intervalMs)
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref() // Don't prevent process exit
    }
  }

  /** Stop periodic cleanup */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** Number of cache keys (name+type+class combinations) */
  get size(): number {
    return this.entries.size
  }
}
