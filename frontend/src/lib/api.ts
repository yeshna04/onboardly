// Thin fetch wrapper: JSON in/out, CSRF header, consistent ApiError.

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field-level messages ({field: message}) for form highlighting. */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details ?? {})) if (typeof v === "string") out[k] = v;
    return out;
  }
}

export const DEMO_BLOCKED_EVENT = "demo-account-blocked";

let demoCode = "";
try { demoCode = sessionStorage.getItem("demoCode") ?? ""; } catch { /* storage unavailable */ }
export function setDemoCode(code: string) {
  demoCode = code;
  try { sessionStorage.setItem("demoCode", code); } catch { /* ignore */ }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (demoCode) headers["X-Demo-Code"] = demoCode;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server. Is the backend running?");
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = data?.error;
    // A shared demo login tried to change something: let the portal open its "create your account" pop-up.
    if (err?.code === "demo_account") window.dispatchEvent(new CustomEvent(DEMO_BLOCKED_EVENT));
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form),
};
