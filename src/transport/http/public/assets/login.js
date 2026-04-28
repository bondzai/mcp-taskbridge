/* Login page — no chrome imports needed. */

// Apply saved theme so the login page matches the user's preference.
(() => {
  try {
    const raw = localStorage.getItem("taskbridge.settings.v1");
    if (!raw) return;
    const { theme } = JSON.parse(raw);
    if (!theme || theme === "auto") {
      const effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dim" : "light";
      document.documentElement.setAttribute("data-theme", effective);
      document.documentElement.setAttribute("data-bs-theme", effective === "light" ? "light" : "dark");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-bs-theme", theme === "light" ? "light" : "dark");
    }
  } catch { /* ignore */ }
})();

const form = document.getElementById("tb-login-form");
const errorEl = document.getElementById("tb-login-error");
const usernameEl = document.getElementById("tb-username");
const passwordEl = document.getElementById("tb-password");

const showError = (msg) => {
  errorEl.textContent = msg;
  errorEl.classList.add("visible");
};

const hideError = () => {
  errorEl.classList.remove("visible");
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!username || !password) {
    showError("Please enter both username and password.");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Signing in…';

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.ok) {
      window.location.href = "/";
      return;
    }
    showError(data.error || "Invalid credentials");
  } catch (err) {
    showError("Network error — please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Sign in';
  }
});
