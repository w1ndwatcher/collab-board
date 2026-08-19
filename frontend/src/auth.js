const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function getToken() {
  return localStorage.getItem("access_token");
}

export function setToken(token) {
  localStorage.setItem("access_token", token);
}

export function clearToken() {
  localStorage.removeItem("access_token");
}

// Turn a DRF error response (or a fetch failure) into a friendly message.
export async function apiErrorMessage(res, fallback) {
  try {
    const data = await res.json();
    if (typeof data === "string" && data) return data;
    if (data && data.detail) return data.detail;
    if (data && typeof data === "object") {
      const msgs = Object.values(data).flat().filter(Boolean);
      if (msgs.length) return msgs.join(" ");
    }
  } catch (e) {
    /* not JSON — fall through to fallback */
  }
  return fallback;
}

export async function login(email, password) {
  const res = await fetch(`${API_URL}/api/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(
      await apiErrorMessage(res, "Login failed. Please check your email and password.")
    );
  }
  const data = await res.json();
  setToken(data.access);
  return data;
}

export async function register(name, email, password) {
  const res = await fetch(`${API_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) {
    throw new Error(
      await apiErrorMessage(res, "Registration failed. Please try again.")
    );
  }
  return res.json();
}

export function logout() {
  clearToken();
  window.location.href = "/login";
}

export async function fetchWithAuth(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }
  return res;
}
