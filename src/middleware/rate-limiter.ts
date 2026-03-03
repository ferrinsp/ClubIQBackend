const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100;

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(clubId: string): RateLimitResult {
  const now = Date.now();
  let entry = buckets.get(clubId);

  // Clean up expired entry
  if (entry && now >= entry.resetAt) {
    buckets.delete(clubId);
    entry = undefined;
  }

  if (!entry) {
    entry = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(clubId, entry);
    return { allowed: true, limit: MAX_REQUESTS, remaining: MAX_REQUESTS - 1, resetAt: entry.resetAt };
  }

  entry.count++;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);

  if (entry.count > MAX_REQUESTS) {
    return { allowed: false, limit: MAX_REQUESTS, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, limit: MAX_REQUESTS, remaining, resetAt: entry.resetAt };
}
