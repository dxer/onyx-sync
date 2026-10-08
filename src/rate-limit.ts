/**
 * Minimal in-memory sliding-window limiter for abuse-prone endpoints (login).
 * Single-process scope: sufficient for the self-hosted Node deployment; a
 * multi-replica setup would need a shared store instead.
 *
 * Entry cap: the key map is bounded (oldest entries evicted) so a flood of
 * distinct spoofed keys cannot grow memory without bound.
 */
const MAX_LIMITER_KEYS = 5000;

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

  private evictOldestIfNeeded(): void {
    // Map iterates in insertion order, so the first keys are the oldest.
    while (this.failures.size > MAX_LIMITER_KEYS) {
      const oldest = this.failures.keys().next();
      if (oldest.done) break;
      this.failures.delete(oldest.value);
    }
  }

  /** Seconds the key must wait before retrying, or 0 when not currently limited. */
  isLimited(key: string, now = Date.now()): number {
    const kept = this.prune(key, now);
    this.evictOldestIfNeeded();
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
    this.evictOldestIfNeeded();
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

interface ClientIpContext {
  req: {
    raw?: unknown;
    header: (name: string) => string | undefined;
  };
}

/**
 * Resolves the client IP for rate limiting without trusting spoofable headers
 * by default. Order: Node socket remoteAddress (single-node direct) →
 * CF-Connecting-IP (Cloudflare Worker has no socket) → X-Forwarded-For /
 * X-Real-IP only when trustProxy is set → 'unknown'.
 */
export function resolveClientIp(c: ClientIpContext, trustProxy: boolean): string {
  const remoteAddress = (c.req.raw as { socket?: { remoteAddress?: unknown } } | undefined)?.socket?.remoteAddress;
  if (typeof remoteAddress === 'string' && remoteAddress.trim()) {
    return remoteAddress.trim();
  }
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  if (trustProxy) {
    return clientIpFromHeaders({
      'x-forwarded-for': c.req.header('x-forwarded-for'),
      'x-real-ip': c.req.header('x-real-ip')
    });
  }
  return 'unknown';
}
