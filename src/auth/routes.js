import express from "express";
import { validateCredentials } from "./users.js";
import { signToken, verifyToken, COOKIE_NAME } from "./middleware.js";

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const createAuthRoutes = () => {
  const router = express.Router();

  router.use(express.json({ limit: "16kb" }));

  /* POST /api/auth/login */
  router.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body ?? {};
    const user = validateCredentials(username, password);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const token = signToken({
      username: user.username,
      role: user.role,
      exp: Date.now() + SESSION_MAX_AGE_MS,
    });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS,
    });

    return res.json({ ok: true, user: { username: user.username, role: user.role } });
  });

  /* POST /api/auth/logout */
  router.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.json({ ok: true });
  });

  /* GET /api/auth/me — public path, verifies token directly */
  router.get("/api/auth/me", (req, res) => {
    const user = req.user || verifyToken(req.cookies?.[COOKIE_NAME]);
    if (user) {
      return res.json({ ok: true, user: { username: user.username, role: user.role } });
    }
    return res.status(401).json({ ok: false, error: "not authenticated" });
  });

  return router;
};
