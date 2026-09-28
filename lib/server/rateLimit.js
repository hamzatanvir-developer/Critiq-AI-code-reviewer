import "server-only";

const store = globalThis.__critiqRateLimitStore ?? new Map();
globalThis.__critiqRateLimitStore = store;

export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (store.get(key) ?? []).filter(
    (timestamp) => now - timestamp < windowMs,
  );

  if (store.size > 10_000) {
    for (const [storedKey, timestamps] of store) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
        store.delete(storedKey);
      }
    }
  }

  if (recent.length >= limit) {
    store.set(key, recent);
    const retryAfter = Math.max(
      1,
      Math.ceil((windowMs - (now - recent[0])) / 1000),
    );
    return { allowed: false, retryAfter };
  }

  recent.push(now);
  store.set(key, recent);
  return { allowed: true, retryAfter: 0 };
}
