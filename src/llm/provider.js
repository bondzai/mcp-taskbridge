/**
 * LLM provider interface — keep one entrypoint per capability.
 * Switch implementations via env: LLM_PROVIDER=openai|anthropic|...
 *
 * Contract:
 *   extractPrFromDocument(text, { filename }) → {
 *     title:       string,
 *     deadline:    number | null,   // ms epoch
 *     notes:       string | null,
 *     lineItems:   Array<{ materialName, specification, quantity, unit, notes }>,
 *   }
 */

export const createLlmProvider = (env = process.env) => {
  const name = (env.LLM_PROVIDER || "openai").toLowerCase();
  if (name === "openai") {
    return import("./openai.js").then((m) => m.createOpenAiProvider(env));
  }
  throw new Error(`Unknown LLM_PROVIDER: ${name}`);
};
