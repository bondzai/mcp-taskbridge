/**
 * LLM provider interface — keep one entrypoint per capability.
 * Switch implementations via env: LLM_PROVIDER=openai|anthropic|...
 *
 * Contract:
 *   extractPrFromDocument(text, { filename }) → PR        (single, parsed from a file)
 *   generatePrs({ count, industryHint })       → PR[]      (synthetic mock data)
 *
 * PR shape:
 *   { title, deadline (ms epoch | null), notes, lineItems[] }
 *   lineItems[i] = { materialName, specification, quantity, unit, notes? }
 */

export const createLlmProvider = (env = process.env) => {
  const name = (env.LLM_PROVIDER || "openai").toLowerCase();
  if (name === "openai") {
    return import("./openai.js").then((m) => m.createOpenAiProvider(env));
  }
  throw new Error(`Unknown LLM_PROVIDER: ${name}`);
};
