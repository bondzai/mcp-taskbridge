import crypto from "node:crypto";

const ALGORITHM = "sha256";
const PREFIX = "sha256=";

export const SIGNATURE_HEADER = "x-taskbridge-signature";
export const EVENT_HEADER = "x-taskbridge-event";

export const signPayload = (secret, payload) => {
  if (!secret) throw new Error("secret is required");
  if (typeof payload !== "string") throw new Error("payload must be a string");
  const hmac = crypto.createHmac(ALGORITHM, secret);
  hmac.update(payload);
  return PREFIX + hmac.digest("hex");
};

export const verifySignature = (secret, payload, signature) => {
  if (!secret || !payload || !signature) return false;
  if (typeof signature !== "string" || !signature.startsWith(PREFIX)) return false;
  const expected = signPayload(secret, payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};
