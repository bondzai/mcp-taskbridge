/**
 * Currency cache with stale-while-revalidate + hardcoded fallback.
 *
 *   getRates(base) → { base, rates, fetchedAt, source, stale }
 *
 * Behaviour:
 *  1. Fresh cache entry (< TTL) → return it directly.
 *  2. Stale entry (>= TTL) → kick off a background refresh, return stale
 *     immediately (the next request will see the refreshed value).
 *  3. No entry yet → await upstream. If upstream fails, fall back to
 *     baked-in rates (FALLBACK below) so the app never breaks.
 *
 * The cache lives in-process. With Cloud Run min-instances=1 this is
 * fine; with min=0 each cold start re-fetches once.
 */

const TTL_MS = 60 * 60 * 1000;          // 1 hour
const STALE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;  // never serve > 7 days stale

// Last-resort baked-in floor so the app keeps rendering even if upstream
// has been down for a long time and the cache is empty (e.g. cold start
// during a Frankfurter outage). Numbers are rough — they exist purely to
// avoid an "undefined / NaN" UI, not to be authoritative.
const FALLBACK = {
  USD: { USD: 1,    THB: 35.5, EUR: 0.92, GBP: 0.79, JPY: 152, SGD: 1.34, CNY: 7.20 },
  THB: { USD: 0.028, THB: 1,   EUR: 0.026, GBP: 0.022 },
  EUR: { USD: 1.09, THB: 38.6, EUR: 1,    GBP: 0.86 },
};

export const createCurrencyCache = ({ provider, logger = console, ttlMs = TTL_MS } = {}) => {
  const cache = new Map();         // base → { rates, fetchedAt, source }
  const inflight = new Map();      // base → Promise

  const now = () => Date.now();
  const isFresh = (entry) => entry && (now() - entry.fetchedAt) < ttlMs;
  const isUsable = (entry) => entry && (now() - entry.fetchedAt) < STALE_LIMIT_MS;

  const refresh = async (base) => {
    if (inflight.has(base)) return inflight.get(base);
    const p = provider.fetchRates(base)
      .then((res) => {
        const entry = { rates: res.rates, fetchedAt: now(), source: res.source };
        cache.set(base, entry);
        return entry;
      })
      .catch((err) => {
        logger.warn?.("currency: refresh failed", { base, error: err.message });
        throw err;
      })
      .finally(() => { inflight.delete(base); });
    inflight.set(base, p);
    return p;
  };

  const fallbackEntry = (base) => {
    const rates = FALLBACK[base];
    if (!rates) return null;
    return { rates, fetchedAt: 0, source: "fallback" };
  };

  return {
    /**
     * Returns the active rate snapshot. Awaits a fresh fetch ONLY when
     * there is no usable cached entry at all — otherwise returns
     * (possibly stale) cached data immediately and refreshes in the
     * background.
     */
    async getRates(base = "USD") {
      const upper = String(base).toUpperCase();
      const entry = cache.get(upper);

      if (isFresh(entry)) {
        return { base: upper, rates: entry.rates, fetchedAt: entry.fetchedAt, source: entry.source, stale: false };
      }

      if (isUsable(entry)) {
        // Serve stale, refresh in background.
        refresh(upper).catch(() => { /* logged in refresh */ });
        return { base: upper, rates: entry.rates, fetchedAt: entry.fetchedAt, source: entry.source, stale: true };
      }

      // No usable entry — block on upstream.
      try {
        const fresh = await refresh(upper);
        return { base: upper, rates: fresh.rates, fetchedAt: fresh.fetchedAt, source: fresh.source, stale: false };
      } catch {
        const fb = fallbackEntry(upper);
        if (!fb) throw new Error(`No fallback rates for base ${upper}`);
        return { base: upper, rates: fb.rates, fetchedAt: fb.fetchedAt, source: fb.source, stale: true };
      }
    },

    /** For tests / forced reload. */
    invalidate(base) { cache.delete(String(base).toUpperCase()); },
  };
};
