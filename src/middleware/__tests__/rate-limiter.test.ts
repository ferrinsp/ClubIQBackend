import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '../rate-limiter.js';

describe('checkRateLimit', () => {
  beforeEach(() => {
    // Reset the internal bucket map by importing a fresh module
    // Since we can't reset the Map directly, we use unique club IDs per test
    vi.useFakeTimers();
  });

  it('allows the first request', () => {
    const result = checkRateLimit('test-club-first');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(99);
  });

  it('decrements remaining on subsequent requests', () => {
    const id = 'test-club-decrement';
    checkRateLimit(id);
    const result = checkRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(98);
  });

  it('blocks after 100 requests within the window', () => {
    const id = 'test-club-block';
    for (let i = 0; i < 100; i++) {
      const r = checkRateLimit(id);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimit(id);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the 1-minute window expires', () => {
    const id = 'test-club-reset';
    for (let i = 0; i < 100; i++) {
      checkRateLimit(id);
    }
    const blocked = checkRateLimit(id);
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);

    const after = checkRateLimit(id);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(99);
  });

  it('tracks different clubs independently', () => {
    const club1 = 'test-rate-club-a';
    const club2 = 'test-rate-club-b';

    for (let i = 0; i < 100; i++) {
      checkRateLimit(club1);
    }

    const blocked = checkRateLimit(club1);
    expect(blocked.allowed).toBe(false);

    const club2Result = checkRateLimit(club2);
    expect(club2Result.allowed).toBe(true);
    expect(club2Result.remaining).toBe(99);
  });

  it('returns correct resetAt timestamp', () => {
    const now = Date.now();
    const id = 'test-club-ts';
    const result = checkRateLimit(id);
    // resetAt should be ~60 seconds from now
    expect(result.resetAt).toBeGreaterThanOrEqual(now + 59_000);
    expect(result.resetAt).toBeLessThanOrEqual(now + 61_000);
  });
});
