/**
 * Currency provider — pluggable like the LLM provider.
 * Default: frankfurter.app (ECB rates, free, no API key).
 * Switch via env CURRENCY_PROVIDER=frankfurter|... .
 *
 * Provider contract:
 *   fetchRates(base) → { base, rates: { CCY: number, ... }, source: string }
 */
export const createCurrencyProvider = async (env = process.env) => {
  const name = (env.CURRENCY_PROVIDER || "frankfurter").toLowerCase();
  if (name === "frankfurter") {
    const { createFrankfurterProvider } = await import("./frankfurter.js");
    return createFrankfurterProvider(env);
  }
  throw new Error(`Unknown CURRENCY_PROVIDER: ${name}`);
};
