import { createSignal } from "solid-js";

const KEY = "gsg-token";
export const [me, setMe] = createSignal(null);
export const setToken = t => localStorage.setItem(KEY, t);
export const clearToken = () => { localStorage.removeItem(KEY); setMe(null); };

export async function api(path, body) {
  const t = localStorage.getItem(KEY);
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) },
    body: body && JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = j.error || (r.status === 404 ? "API route not found. Check the Vercel API function deployment or local API server." : "Request failed");
    throw Object.assign(new Error(error), { status: r.status });
  }
  return j;
}

export async function refreshMe() {
  if (!localStorage.getItem(KEY)) return setMe(null);
  try { setMe(await api("/api/me")); } catch { clearToken(); }
}
