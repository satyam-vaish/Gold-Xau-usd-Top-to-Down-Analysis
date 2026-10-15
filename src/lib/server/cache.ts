/**
 * Cache layer — TTL memory cache with a Redis-compatible interface.
 * In this sandbox, an in-process TTL map is used (documented in README).
 * The docker-compose production deployment provisions Redis; switching the
 * driver only requires implementing the same 4 methods against ioredis.
 */
type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
let hits = 0, misses = 0;

export const cache = {
  get<T>(key: string): T | null {
    const e = store.get(key);
    if (!e) { misses++; return null; }
    if (Date.now() > e.expires) { store.delete(key); misses++; return null; }
    hits++;
    return e.value as T;
  },
  set(key: string, value: unknown, ttlSeconds: number): void {
    store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    // opportunistic cleanup
    if (store.size > 500) {
      const now = Date.now();
      for (const [k, v] of store) if (now > v.expires) store.delete(k);
    }
  },
  del(prefix: string): void {
    for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  },
  stats() {
    return { keys: store.size, hits, misses, driver: "memory-ttl (Redis-ready interface)" };
  },
};
