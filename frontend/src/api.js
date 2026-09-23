// Client for ConveyorRouting.Api. Every response is an OEMResponse {statusCode, data, message, error};
// api() returns data, or throws Error(message). A JWT is fetched from /api/Auth/getToken (as in SmartMES).
// API address: config.js (window.APP_CONFIG.apiBase, editable on the server), else VITE_API_BASE, else same site.
const BASE = (window.APP_CONFIG?.apiBase || import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
let token = null;
let tokenRequest = null;   // one shared getToken call, however many requests start at once

// fetch() only says "Failed to fetch" when the API can't be reached or the browser blocks the answer (CORS)
async function send(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    const api = BASE || window.location.origin;
    throw new Error(`Cannot reach the API at ${api}. Check apiBase in config.js, and that "${window.location.origin}" `
      + `is listed in Cors:Origins in the API's appsettings.json (then recycle the API app pool). `
      + `Press F12 > Console for the browser's exact reason.`);
  }
}

function fetchToken() {
  if (!tokenRequest) {
    tokenRequest = (async () => {
      const res = await send(`${BASE}/api/Auth/getToken`);
      if (!res.ok) throw new Error(`Could not get an API token (HTTP ${res.status})`);
      token = (await res.json()).token;
    })().finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
}

export async function request(method, path, { params, body, headers } = {}) {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== "" && v != null));
  const url = `${BASE}${path}${qs.toString() ? "?" + qs : ""}`;
  for (let attempt = 0; ; attempt++) {
    if (!token) await fetchToken();
    const h = { ...headers, Authorization: `Bearer ${token}` };
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await send(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
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
