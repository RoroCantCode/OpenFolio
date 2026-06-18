/**
 * Yahoo Finance chart/quote access for server-side use (Render, local API).
 * Datacenter IPs are blocked without a session cookie + crumb.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const SESSION_TTL_MS = 30 * 60 * 1000;

type YahooSession = { cookie: string; crumb: string; at: number };

let sessionCache: YahooSession | null = null;
let sessionPromise: Promise<YahooSession> | null = null;

function collectSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
}

async function fetchYahooSession(): Promise<YahooSession> {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    redirect: "manual",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  });

  let cookies = cookieHeaderFromSetCookies(collectSetCookies(cookieRes));

  if ((cookieRes.status === 301 || cookieRes.status === 302) && !cookies) {
    const location = cookieRes.headers.get("location");
    if (location) {
      const next = await fetch(location, {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      cookies = cookieHeaderFromSetCookies(collectSetCookies(next));
    }
  }

  if (!cookies) {
    throw new Error("Yahoo Finance session cookie unavailable.");
  }

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/plain",
      Cookie: cookies,
    },
  });

  if (!crumbRes.ok) {
    throw new Error(`Yahoo Finance crumb request failed (${crumbRes.status}).`);
  }

  const crumb = (await crumbRes.text()).trim();
  if (!crumb) {
    throw new Error("Yahoo Finance returned an empty crumb.");
  }

  return { cookie: cookies, crumb, at: Date.now() };
}

async function getYahooSession(force = false): Promise<YahooSession> {
  const now = Date.now();
  if (!force && sessionCache && now - sessionCache.at < SESSION_TTL_MS) {
    return sessionCache;
  }
  if (!force && sessionPromise) return sessionPromise;

  sessionPromise = fetchYahooSession()
    .then((session) => {
      sessionCache = session;
      return session;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
}

export function normalizeYahooSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

export type YahooChartJson = {
  chart?: {
    error?: { description?: string };
    result?: {
      meta?: { regularMarketPrice?: number; symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

/** Fetch Yahoo chart JSON with cookie + crumb (works from cloud hosts). */
export async function fetchYahooChart(symbolPath: string, query: string): Promise<YahooChartJson | null> {
  const sym = encodeURIComponent(normalizeYahooSymbol(symbolPath));
  const attempt = async (forceSession: boolean): Promise<YahooChartJson | null> => {
    const { cookie, crumb } = await getYahooSession(forceSession);
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?${query}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
        Cookie: cookie,
      },
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    return (await res.json()) as YahooChartJson;
  };

  let json = await attempt(false);
  if (json?.chart?.error || !json?.chart?.result?.length) {
    sessionCache = null;
    json = await attempt(true);
  }
  if (json?.chart?.error || !json?.chart?.result?.length) return null;
  return json;
}

export function readRegularMarketPrice(json: YahooChartJson): number | null {
  const meta = json.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof meta === "number" && Number.isFinite(meta)) return meta;
  const close = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    ?.filter((x): x is number => x != null && Number.isFinite(x))
    .pop();
  return typeof close === "number" ? close : null;
}

export function readDailyCloses(json: YahooChartJson): { t: number[]; c: (number | null)[] } | null {
  const r = json.chart?.result?.[0];
  const t = r?.timestamp;
  const c = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(t) || !Array.isArray(c) || t.length === 0) return null;
  return { t, c };
}

/** Clear cached Yahoo session (for tests or after repeated failures). */
export function resetYahooSessionCache(): void {
  sessionCache = null;
  sessionPromise = null;
}
