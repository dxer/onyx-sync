/**
 * Minimal in-memory sliding-window limiter for abuse-prone endpoints (login).
 * Single-process scope: sufficient for the self-hosted Node deployment; a
 * multi-replica setup would need a shared store instead.
 */
export class SlidingWindowRateLimiter {
  private failures = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 10, windowSeconds = 600) {
    this.maxAttempts = Math.max(1, Math.floor(maxAttempts));
    this.windowMs = Math.max(1_000, Math.floor(windowSeconds) * 1000);
  }

  private prune(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const kept = (this.failures.get(key) || []).filter((t) => t > cutoff);
    if (kept.length === 0) {
      this.failures.delete(key);
    } else {
      this.failures.set(key, kept);
    }
    return kept;
  }

  /** Seconds the key must wait before retrying, or 0 when not currently limited. */
  isLimited(key: string, now = Date.now()): number {
    const kept = this.prune(key, now);
    if (kept.length < this.maxAttempts) return 0;
    return Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
  }

  /**
   * Records one failed attempt. Returns 0 when still allowed, otherwise the
   * seconds to wait (the attempt that trips the limit is rejected too).
   */
  registerFailure(key: string, now = Date.now()): number {
    const kept = this.prune(key, now);
    kept.push(now);
    this.failures.set(key, kept);
    if (kept.length < this.maxAttempts) return 0;
    return Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
  }

  /** A successful login clears the failure history for the key. */
  reset(key: string): void {
    this.failures.delete(key);
  }
}

/** Best-effort client IP. Relies on the reverse proxy overwriting X-Forwarded-For. */
export function clientIpFromHeaders(headers: { 'x-forwarded-for'?: string; 'x-real-ip'?: string }): string {
  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = headers['x-real-ip']?.trim();
  if (realIp) return realIp;
  return 'unknown';
}
