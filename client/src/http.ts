/** API base URL. Empty in dev uses Vite proxy (/api). Set in production to your backend origin. */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function resolveUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== "string") return input;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  if (!API_BASE) return input;
  return `${API_BASE}${input.startsWith("/") ? input : `/${input}`}`;
}

/** All API calls send session cookies (multi-user auth). */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(resolveUrl(input), { credentials: "include", ...init });
}
