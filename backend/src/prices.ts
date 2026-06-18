const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 60_000;

type YahooChart = {
  chart?: { result?: { meta?: { regularMarketPrice?: number }; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
};

export async function fetchUsdPrice(ticker: string): Promise<number | null> {
  const upper = ticker.trim().toUpperCase();
  const now = Date.now();
  const hit = cache.get(upper);
  if (hit && now - hit.at < TTL_MS) return hit.price;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(upper)}?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "OpenFolio/1.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChart;
    const result = json.chart?.result?.[0];
    const meta = result?.meta?.regularMarketPrice;
    if (typeof meta === "number" && Number.isFinite(meta)) {
      cache.set(upper, { price: meta, at: now });
      return meta;
    }
    const close = result?.indicators?.quote?.[0]?.close?.filter((x): x is number => x != null).pop();
    if (typeof close === "number" && Number.isFinite(close)) {
      cache.set(upper, { price: close, at: now });
      return close;
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchPrices(tickers: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
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
