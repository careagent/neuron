/**
 * Token bucket rate limiter for per-API-key rate limiting.
 *
 * In-memory implementation. Buckets are created on first request per key
 * and refill based on elapsed time. Stale buckets (>10 min inactive)
 * are cleaned up lazily.
 */

/** Internal bucket state */
interface Bucket {
  tokens: number
  lastRefill: number
  lastAccess: number
}

/** Stale bucket threshold: 10 minutes */
const STALE_THRESHOLD_MS = 10 * 60 * 1000

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  /**
   * @param maxTokens - Maximum tokens per bucket (burst capacity)
   * @param refillRate - Tokens refilled per window
   * @param windowMs - Refill window in milliseconds
   */
  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Try to consume one token for the given key.
   * Returns true if allowed, false if rate limited.
   */
  consume(keyId: string): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(keyId)

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now, lastAccess: now }
      this.buckets.set(keyId, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    const refill = Math.floor((elapsed / this.windowMs) * this.refillRate)
    if (refill > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill)
      bucket.lastRefill = now
    }

    bucket.lastAccess = now

    if (bucket.tokens > 0) {
      bucket.tokens--
      return true
    }

    return false
  }

  /**
   * Get the estimated seconds until the next token is available.
   * Returns 0 for unknown keys.
   */
  retryAfter(keyId: string): number {
    const bucket = this.buckets.get(keyId)
    if (!bucket) return 0
    const msPerToken = this.windowMs / this.refillRate
    return Math.ceil(msPerToken / 1000)
  }

  /**
   * Remove stale buckets (not accessed in >10 minutes).
   * Called lazily to prevent memory leaks from inactive keys.
   */
  cleanup(): void {
    const now = Date.now()
    for (const [keyId, bucket] of this.buckets) {
      if (now - bucket.lastAccess > STALE_THRESHOLD_MS) {
        this.buckets.delete(keyId)
      }
    }
  }
}
