import crypto from "node:crypto";

const AUTH_SECRET = process.env.AUTH_SECRET || "dev-auth-secret-change-me";
const COOKIE_NAME = "tb_session";

/**
 * Sign a payload with HMAC-SHA256 and return base64(JSON) + "." + signature.
 */
const signToken = (payload) => {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
};

/**
 * Verify and decode a signed token.  Returns the payload or null.
 */
const verifyToken = (token) => {
  if (!token || typeof token !== "string") return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx < 1) return null;
  const data = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const json = Buffer.from(data, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

export { signToken, verifyToken, COOKIE_NAME, AUTH_SECRET };

/* Paths that never require authentication. */
const PUBLIC_PATHS = new Set([
  "/login.html",
  "/api/auth/login",
  "/api/auth/me",
  "/api/health",
  "/api/events",
]);

const isPublic = (pathname) => {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) return true;
  // Allow webhook endpoint (signed separately)
  if (pathname.startsWith("/webhooks/")) return true;
  return false;
};

/**
 * Factory — returns Express middleware that guards routes behind cookie auth.
 */
export const createAuthMiddleware = () => {
  return (req, res, next) => {
    if (isPublic(req.path)) return next();

    const token = req.cookies?.[COOKIE_NAME];
    const payload = verifyToken(token);

    if (payload) {
      req.user = { username: payload.username, role: payload.role };
      return next();
    }

    // Not authenticated — decide response format.
    const wantsHtml =
      req.headers.accept?.includes("text/html") && !req.headers.accept?.includes("application/json");
    if (wantsHtml) {
      return res.redirect("/login.html");
    }
    return res.status(401).json({ error: "authentication required" });
  };
};
