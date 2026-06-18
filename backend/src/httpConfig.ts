/**
 * CORS and session cookie settings for local dev vs cross-origin production
 * (e.g. GitHub Pages frontend + hosted Express API).
 */

export type SessionCookieOptions = {
  httpOnly: boolean;
  maxAge: number;
  sameSite: "lax" | "none";
  secure: boolean;
  path: string;
};

const SESSION_COOKIE_NAME = "openfolio.sid";

/** Comma-separated allowed browser origins, e.g. https://user.github.io,http://localhost:5000 */
export function getClientOrigins(): string[] {
  const raw = process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when CLIENT_ORIGINS is set — cross-site session cookies required. */
export function isCrossOriginDeployment(): boolean {
  return getClientOrigins().length > 0;
}

export function getSessionCookieOptions(): SessionCookieOptions {
  const crossSite = isCrossOriginDeployment();
  const secure =
    crossSite || process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: crossSite ? "none" : "lax",
    secure: crossSite ? true : secure,
    path: "/",
  };
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function getClearCookieOptions(): Pick<SessionCookieOptions, "path" | "httpOnly" | "sameSite" | "secure"> {
  const o = getSessionCookieOptions();
  return {
    path: o.path,
    httpOnly: o.httpOnly,
    sameSite: o.sameSite,
    secure: o.secure,
  };
}

/**
 * CORS origin callback. When CLIENT_ORIGINS is unset, reflect any origin (local dev).
 * When set, only listed origins receive Access-Control-Allow-Credentials.
 */
export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  const allowed = getClientOrigins();
  if (allowed.length === 0) {
    callback(null, true);
    return;
  }
  if (!origin) {
    callback(null, true);
    return;
  }
  if (allowed.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}

export function shouldTrustProxy(): boolean {
  return process.env.TRUST_PROXY === "true" || isCrossOriginDeployment();
}
