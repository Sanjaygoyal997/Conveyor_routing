// Client for ConveyorRouting.Api. Every response is an OEMResponse {statusCode, data, message, error};
// api() returns data, or throws Error(message). A JWT is fetched from /api/Auth/getToken (as in SmartMES).
const BASE = import.meta.env.VITE_API_BASE || "";
let token = null;

async function fetchToken() {
  const res = await fetch(`${BASE}/api/Auth/getToken`);
  if (!res.ok) throw new Error(`Could not get an API token (HTTP ${res.status})`);
  token = (await res.json()).token;
}

export async function request(method, path, { params, body, headers } = {}) {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== "" && v != null));
  const url = `${BASE}${path}${qs.toString() ? "?" + qs : ""}`;
  for (let attempt = 0; ; attempt++) {
    if (!token) await fetchToken();
    const h = { ...headers, Authorization: `Bearer ${token}` };
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let out = null;
    try { out = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    // 401 without an OEMResponse = JWT missing/expired: get a new token once
    if (res.status === 401 && !out && attempt === 0) { token = null; continue; }
    if (!res.ok) throw new Error(out?.message || `HTTP ${res.status}${text && !out ? `: ${text.slice(0, 200)}` : ""}`);
    return out && typeof out === "object" && "statusCode" in out ? out.data : out;
  }
}

export const api = (path, params) => request("GET", path, { params });
