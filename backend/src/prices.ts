import {
  fetchYahooChart,
  normalizeYahooSymbol,
  readRegularMarketPrice,
} from "./yahooFinance.js";

const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 60_000;

export async function fetchUsdPrice(ticker: string): Promise<number | null> {
  const upper = normalizeYahooSymbol(ticker);
  if (!upper) return null;
  const now = Date.now();
  const hit = cache.get(upper);
  if (hit && now - hit.at < TTL_MS) return hit.price;

  const json = await fetchYahooChart(upper, "range=1d&interval=1d");
  if (!json) return null;

  const price = readRegularMarketPrice(json);
  if (price == null) return null;

  cache.set(upper, { price, at: now });
  return price;
}

export async function fetchPrices(tickers: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(tickers.map((t) => normalizeYahooSymbol(t)).filter(Boolean))];
  const out: Record<string, number | null> = {};
  await Promise.all(
    unique.map(async (t) => {
      out[t] = await fetchUsdPrice(t);
    })
  );
  return out;
}

/** SGD per 1 USD (spot / last close). */
export async function fetchUsdSgdLive(): Promise<number | null> {
  return fetchUsdPrice("USDSGD=X");
}
