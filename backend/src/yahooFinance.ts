/**
 * Yahoo Finance access for server-side use (Render, local API).
 *
 * Yahoo's public market-data endpoints fall into two families:
 *   - /v8/finance/chart/{symbol}  and  /v8/finance/spark  -> NO auth required
 *   - /v7/finance/quote                                   -> requires cookie + "crumb"
 *
 * The cookie+crumb handshake is effectively unusable from server / datacenter IPs:
 * the historical `fc.yahoo.com` cookie source is gone (404) and Yahoo's `getcrumb`
 * endpoint rejects the fallback cookies as "Invalid Cookie" (401). Previously every
 * request was gated on obtaining that crumb, so when the handshake failed (almost
 * always, server-side) the *entire* app lost market data — even though the data it
 * needed lives behind the crumb-free chart/spark endpoints.
 *
 * This module therefore relies only on the crumb-free endpoints, batching live
 * quotes through /v8/finance/spark and falling back to /v8/finance/chart per symbol.
 * Every call is wrapped in retry + exponential backoff (with jitter) and rotates
 * across Yahoo's query1/query2 hosts. Nothing here depends on user authentication,
 * cookies, or tokens, so behaviour is identical for logged-in and logged-out users.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const QUOTE_CHUNK = 25;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 4000;
/** Cap concurrent outbound Yahoo requests so we never trip rate limits in bursts. */
const MAX_CONCURRENCY = 4;
const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const expo = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(expo / 2 + Math.random() * (expo / 2));
}

function yahooHeaders(accept = "application/json"): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: accept,
    Referer: "https://finance.yahoo.com/",
    Origin: "https://finance.yahoo.com",
  };
}

/** Small semaphore so concurrent callers (portfolio + watchlist + fx) don't burst. */
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Yahoo request failed (${status}).`);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  }
  // Network-level failures (DNS, reset, timeout, abort) are transient.
  return true;
}

/**
 * GET a Yahoo JSON endpoint with retry + backoff + host rotation. Rotates the
 * host on every attempt so a single flaky edge node can't sink the request.
 */
async function fetchYahooJson<T>(pathWithQuery: string, accept = "application/json"): Promise<T> {
  await acquireSlot();
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const host = HOSTS[attempt % HOSTS.length];
      try {
        const res = await fetch(`${host}${pathWithQuery}`, { headers: yahooHeaders(accept) });
        if (!res.ok) throw new HttpStatusError(res.status);
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e) || attempt === MAX_ATTEMPTS - 1) break;
        await sleep(backoffDelay(attempt));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Yahoo request failed.");
  } finally {
    releaseSlot();
  }
}

/**
 * No-op kept for API stability. The crumb-free endpoints need no warm-up, but
 * we issue one cheap ping so DNS/TLS is hot and we can log connectivity early.
 */
export async function warmYahooSession(): Promise<boolean> {
  try {
    await fetchYahooJson("/v8/finance/chart/AAPL?range=1d&interval=1d");
    return true;
  } catch (e) {
    console.error("Yahoo connectivity check failed:", e);
    return false;
  }
}

/** Kept for API stability — no session/crumb is required any more. */
export async function ensureYahooReady(): Promise<void> {
  /* crumb-free endpoints need no session */
}

export function normalizeYahooSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

export type YahooChartJson = {
  chart?: {
    error?: { description?: string };
    result?: {
      meta?: {
        regularMarketPrice?: number;
        symbol?: string;
        currency?: string;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

type YahooSparkEntry = { symbol?: string; close?: (number | null)[]; chartPreviousClose?: number };
type YahooSparkJson = Record<string, YahooSparkEntry | undefined>;

function lastFinite(arr?: (number | null)[]): number | null {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Pull the latest live price for each requested symbol out of a spark payload. */
function applySparkRows(out: Record<string, number | null>, chunk: string[], json: YahooSparkJson): void {
  for (const sym of chunk) {
    const entry = json[sym];
    const px = lastFinite(entry?.close);
    if (px != null) out[sym] = px;
  }
}

async function fetchQuoteChunk(chunk: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const s of chunk) out[s] = null;

  const symbolsParam = chunk.map(encodeURIComponent).join(",");
  try {
    const json = await fetchYahooJson<YahooSparkJson>(
      `/v8/finance/spark?symbols=${symbolsParam}&range=1d&interval=1d`
    );
    applySparkRows(out, chunk, json);
  } catch (e) {
    console.warn("Yahoo spark batch failed; will fall back to per-symbol charts:", e);
  }
  return out;
}

/** Batch live quotes via the crumb-free spark endpoint, chart-fallback per miss. */
export async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  const out: Record<string, number | null> = {};
  for (const sym of unique) out[sym] = null;
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
    const chunk = unique.slice(i, i + QUOTE_CHUNK);
    const got = await fetchQuoteChunk(chunk);
    for (const sym of chunk) {
      if (got[sym] != null) out[sym] = got[sym];
    }
  }

  // Any symbol the batch endpoint missed: resolve via the single-symbol chart API.
  const missing = unique.filter((s) => out[s] == null);
  await mapWithConcurrency(missing, MAX_CONCURRENCY, async (sym) => {
    const json = await fetchYahooChart(sym, "range=1d&interval=1d");
    const px = json ? readRegularMarketPrice(json) : null;
    if (px != null) out[sym] = px;
  });

  return out;
}

/** Fetch Yahoo chart JSON (historical / momentum) via the crumb-free chart API. */
export async function fetchYahooChart(symbolPath: string, query: string): Promise<YahooChartJson | null> {
  const sym = encodeURIComponent(normalizeYahooSymbol(symbolPath));
  try {
    const json = await fetchYahooJson<YahooChartJson>(`/v8/finance/chart/${sym}?${query}`);
    if (json.chart?.error || !json.chart?.result?.length) {
      throw new Error(json.chart?.error?.description ?? "empty chart result");
    }
    return json;
  } catch (e) {
    console.warn(`Yahoo chart ${symbolPath} failed:`, e);
    return null;
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
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

/** Kept for API stability — there is no session cache to reset any more. */
export function resetYahooSessionCache(): void {
  /* no cookie/crumb session is maintained */
}
