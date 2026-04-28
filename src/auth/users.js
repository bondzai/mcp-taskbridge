/* Mock user store — replace with a real database later. */

const USERS = {
  admin: { password: "admin", role: "admin" },
  viewer: { password: "viewer", role: "viewer" },
};

/**
 * Validate credentials against the mock store.
 * @returns {{ username: string, role: string } | null}
 */
export const validateCredentials = (username, password) => {
  if (!username || !password) return null;
  const entry = USERS[username];
  if (!entry || entry.password !== password) return null;
  return { username, role: entry.role };
};

export const MOCK_USERS = USERS;
