/**
 * Historical closes via Yahoo Finance chart API.
 * Google Finance does not expose a reliable, documented HTTP API for historical
 * OHLC or cross rates suitable for server-side automation; Yahoo's chart endpoint
 * provides the same daily series used by many retail finance widgets.
 */

const UA = {
  "User-Agent": "OpenFolio/1.0 (portfolio tracker)",
  Accept: "application/json",
} as const;

type YahooChartFull = {
  chart?: {
    error?: { description?: string };
    result?: {
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

function utcEndOfCalendarDayMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function validateTradeCalendarDate(ymd: string): { ok: true; ymd: string } | { ok: false; message: string } {
  const p = parseYmd(ymd);
  if (!p) return { ok: false, message: "Enter a valid calendar date (YYYY-MM-DD)." };
  const end = utcEndOfCalendarDayMs(p.y, p.m, p.d);
  const now = Date.now();
  if (end > now) return { ok: false, message: "Trade date cannot be in the future." };
  const min = Date.UTC(1990, 0, 1, 0, 0, 0, 0);
  if (end < min) return { ok: false, message: "Trade date is too far in the past (minimum 1990-01-01)." };
  return { ok: true, ymd: `${p.y.toString().padStart(4, "0")}-${p.m.toString().padStart(2, "0")}-${p.d.toString().padStart(2, "0")}` };
}

function yahooSymbolForTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase().replace(/\./g, "-");
  return encodeURIComponent(t);
}

async function fetchYahooDailyCloses(
  symbol: string,
  period1Sec: number,
  period2Sec: number
): Promise<{ t: number[]; c: (number | null)[] } | { error: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1Sec}&period2=${period2Sec}&interval=1d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    return { error: `Market data request failed (${res.status}).` };
  }
  const json = (await res.json()) as YahooChartFull;
  const err = json.chart?.error?.description;
  if (err) return { error: err };
  const r = json.chart?.result?.[0];
  const t = r?.timestamp;
  const closeArr = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(t) || !Array.isArray(closeArr) || t.length === 0) {
    return { error: "No historical series returned for this symbol." };
  }
  return { t, c: closeArr };
}

/** Last daily close on or before end of selected UTC calendar day (inclusive). */
export function pickCloseOnOrBefore(
  timestampsSec: number[],
  closes: (number | null)[],
  endUtcMs: number
): { close: number; barUtcMs: number } | null {
  let best: { close: number; barUtcMs: number } | null = null;
  for (let i = 0; i < timestampsSec.length; i++) {
    const tsMs = timestampsSec[i] * 1000;
    const cl = closes[i];
    if (cl == null || !Number.isFinite(cl)) continue;
    if (tsMs <= endUtcMs) {
      if (!best || tsMs > best.barUtcMs) best = { close: cl, barUtcMs: tsMs };
    }
  }
  return best;
}

export async function lookupUsdSgdOnTradeDate(ymd: string): Promise<
  | { ok: true; fxSgdPerUsd: number; barUtcMs: number }
  | { ok: false; message: string }
> {
  const v = validateTradeCalendarDate(ymd);
  if (!v.ok) return { ok: false, message: v.message };
  const p = parseYmd(v.ymd)!;
  const endUtcMs = utcEndOfCalendarDayMs(p.y, p.m, p.d);
  const period2 = Math.floor(endUtcMs / 1000) + 86400;
  const period1 = period2 - 86400 * 400;

  const sym = yahooSymbolForTicker("USDSGD=X");
  const raw = await fetchYahooDailyCloses(sym, period1, period2);
  if ("error" in raw) return { ok: false, message: raw.error };

  const picked = pickCloseOnOrBefore(raw.t, raw.c, endUtcMs);
  if (!picked || picked.close <= 0) {
    return {
      ok: false,
      message:
        "Could not resolve USD/SGD for this trade date (no daily close on or before that day). Try a different date.",
    };
  }
  return { ok: true, fxSgdPerUsd: picked.close, barUtcMs: picked.barUtcMs };
}

export async function lookupEquityCloseOnTradeDate(
  ticker: string,
  ymd: string
): Promise<{ ok: true; priceUsd: number; barUtcMs: number } | { ok: false; message: string }> {
  const t = ticker.trim().toUpperCase();
  if (!t) return { ok: false, message: "Ticker is required." };
  const v = validateTradeCalendarDate(ymd);
  if (!v.ok) return { ok: false, message: v.message };
  const p = parseYmd(v.ymd)!;
  const endUtcMs = utcEndOfCalendarDayMs(p.y, p.m, p.d);
  const period2 = Math.floor(endUtcMs / 1000) + 86400;
  const period1 = period2 - 86400 * 400;

  const sym = yahooSymbolForTicker(t);
  const raw = await fetchYahooDailyCloses(sym, period1, period2);
  if ("error" in raw) {
    return {
      ok: false,
      message: `Could not load quotes for “${t}”. Check the ticker (Yahoo Finance symbol) and try again. (${raw.error})`,
    };
  }

  const picked = pickCloseOnOrBefore(raw.t, raw.c, endUtcMs);
  if (!picked || picked.close <= 0) {
    return {
      ok: false,
      message: `No closing price found for “${t}” on or before ${v.ymd}. The ticker may be wrong or illiquid for that date.`,
    };
  }
  return { ok: true, priceUsd: picked.close, barUtcMs: picked.barUtcMs };
}

export function occurredAtFromTradeDateYmd(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return new Date().toISOString();
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0, 0)).toISOString();
}
