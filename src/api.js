const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * Fetch a backend API endpoint, inject auth token, parse JSON, and throw on
 * non-OK responses.  Returns null for 204 No Content.
 *
 * @param {string} path - e.g. "/api/lists"
 * @param {{ method?: string, body?: object, token?: string }} [opts]
 */
export async function apiFetch(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
