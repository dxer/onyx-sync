import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter, clientIpFromHeaders } from '../rate-limit';

describe('SlidingWindowRateLimiter', () => {
  it('allows maxAttempts failures, then reports a wait time', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60);
    expect(limiter.registerFailure('1.2.3.4', 0)).toBe(0);
    expect(limiter.registerFailure('1.2.3.4', 1_000)).toBe(0);
    const wait = limiter.registerFailure('1.2.3.4', 2_000);
    expect(wait).toBeGreaterThan(0);
    expect(limiter.isLimited('1.2.3.4', 2_000)).toBe(wait);
  });

  it('forgets failures outside the window', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60);
    limiter.registerFailure('5.6.7.8', 0);
    limiter.registerFailure('5.6.7.8', 1_000);
    expect(limiter.isLimited('5.6.7.8', 2_000)).toBeGreaterThan(0);
    // 61s later both failures expired
    expect(limiter.isLimited('5.6.7.8', 61_000)).toBe(0);
    expect(limiter.registerFailure('5.6.7.8', 61_000)).toBe(0);
  });

  it('tracks keys independently and reset() clears history', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60);
    expect(limiter.registerFailure('a', 0)).toBeGreaterThan(0);
    expect(limiter.isLimited('b', 0)).toBe(0);
    limiter.reset('a');
    expect(limiter.isLimited('a', 0)).toBe(0);
  });
});

describe('clientIpFromHeaders', () => {
  it('prefers the first X-Forwarded-For entry, then X-Real-Ip', () => {
    expect(clientIpFromHeaders({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })).toBe('9.9.9.9');
    expect(clientIpFromHeaders({ 'x-real-ip': '8.8.8.8' })).toBe('8.8.8.8');
    expect(clientIpFromHeaders({})).toBe('unknown');
  });
});
