import { fetchYahooChart, normalizeYahooSymbol, readDailyCloses, type YahooChartJson } from "./yahooFinance.js";

export type PriceChartRange = "1w" | "1mo" | "6mo" | "ytd";

export type PriceChartData = {
  name: string | null;
  changePct: number | null;
  closes: number[];
  timestamps: number[];
};

const MAX_SPARKLINE_POINTS = 64;

const RANGE_LABELS: Record<PriceChartRange, string> = {
  "1w": "1 week",
  "1mo": "1 month",
  "6mo": "6 months",
  ytd: "YTD",
};

export function priceChartRangeLabel(range: PriceChartRange): string {
  return RANGE_LABELS[range];
}

function chartQueryForRange(range: PriceChartRange): string {
  switch (range) {
    case "1w":
      return "range=5d&interval=1d";
    case "1mo":
      return "range=1mo&interval=1d";
    case "6mo":
      return "range=6mo&interval=1d";
    case "ytd":
      return "range=ytd&interval=1d";
  }
}

function readChartMetaName(json: YahooChartJson): string | null {
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const long = meta.longName?.trim();
  if (long) return long;
  const short = meta.shortName?.trim();
  return short || null;
}

function downsampleSeries(
  values: number[],
  timestamps: number[],
  maxPoints: number
): { closes: number[]; timestamps: number[] } {
  if (values.length <= maxPoints) return { closes: values, timestamps };
  const closes: number[] = [];
  const ts: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i / (maxPoints - 1)) * (values.length - 1));
    closes.push(values[idx]!);
    ts.push(timestamps[idx] ?? timestamps[timestamps.length - 1]!);
  }
  return { closes, timestamps: ts };
}

/** Daily closes and period return from Yahoo Finance chart API. */
export async function fetchPriceChartData(ticker: string, range: PriceChartRange): Promise<PriceChartData> {
  const sym = normalizeYahooSymbol(ticker);
  if (!sym) return { name: null, changePct: null, closes: [], timestamps: [] };

  const json = await fetchYahooChart(sym, chartQueryForRange(range));
  if (!json) return { name: null, changePct: null, closes: [], timestamps: [] };

  const name = readChartMetaName(json);
  const series = readDailyCloses(json);
  if (!series) return { name, changePct: null, closes: [], timestamps: [] };

  const pairs: { t: number; c: number }[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const c = series.c[i];
    if (c != null && Number.isFinite(c)) pairs.push({ t: series.t[i]!, c });
  }
  if (pairs.length < 2) {
    const closes = pairs.map((p) => p.c);
    const timestamps = pairs.map((p) => p.t);
    const sampled = downsampleSeries(closes, timestamps, MAX_SPARKLINE_POINTS);
    return { name, changePct: null, closes: sampled.closes, timestamps: sampled.timestamps };
  }

  const first = pairs[0]!;
  const last = pairs[pairs.length - 1]!;
  const changePct = first.c === 0 ? null : (last.c - first.c) / first.c;
  const sampled = downsampleSeries(
    pairs.map((p) => p.c),
    pairs.map((p) => p.t),
    MAX_SPARKLINE_POINTS
  );

  return {
    name,
    changePct,
    closes: sampled.closes,
    timestamps: sampled.timestamps,
  };
}

export function isPriceChartRange(value: string): value is PriceChartRange {
  return value === "1w" || value === "1mo" || value === "6mo" || value === "ytd";
}
