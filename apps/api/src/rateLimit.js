const counters = new Map();

function cleanupExpiredCounters(now) {
  for (const [key, record] of counters.entries()) {
    if (record.resetAt <= now) {
      counters.delete(key);
    }
  }
}

export function getRequestIp(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);

  return forwardedFor || request.socket?.remoteAddress || 'unknown';
}

export function consumeRateLimit({ scope, identifier, limit, windowMs }) {
  const safeLimit = Math.max(Number(limit || 0), 1);
  const safeWindowMs = Math.max(Number(windowMs || 0), 1_000);
  const now = Date.now();
  cleanupExpiredCounters(now);

  const key = `${scope}:${identifier}`;
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    const record = {
      count: 1,
      resetAt: now + safeWindowMs
    };
    counters.set(key, record);
    return {
      allowed: true,
      remaining: safeLimit - 1,
      resetAt: record.resetAt
    };
  }

  if (current.count >= safeLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt
    };
  }

  current.count += 1;
  counters.set(key, current);
  return {
    allowed: true,
    remaining: Math.max(safeLimit - current.count, 0),
    resetAt: current.resetAt
  };
}

export function __resetRateLimitsForTests() {
  counters.clear();
}
