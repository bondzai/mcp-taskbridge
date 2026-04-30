/**
 * Frankfurter provider — https://www.frankfurter.app
 * Free, no API key. ECB reference rates, updated daily ~16:00 CET.
 */
const BASE_URL = "https://api.frankfurter.app";
const FETCH_TIMEOUT_MS = 5_000;

export const createFrankfurterProvider = (env) => {
  const baseUrl = env.FRANKFURTER_BASE_URL || BASE_URL;

  return {
    name: "frankfurter",

    async fetchRates(base = "USD") {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/latest?from=${encodeURIComponent(base)}`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
        const body = await res.json();
        if (!body || typeof body.rates !== "object") {
          throw new Error("Frankfurter: malformed response");
        }
        return {
          base,
          rates: { ...body.rates, [base]: 1 },   // include base→base for symmetry
          source: "frankfurter",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
