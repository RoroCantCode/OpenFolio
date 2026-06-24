import type { Db } from "mongodb";
import { fetchPrices } from "./prices.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

/** Watchlist prices only — chart series are loaded client-side via /api/market/price-chart. */
export async function loadWatchlistPayload(
  db: Db,
  userId: string,
  priceMap?: Record<string, number | null>
): Promise<{
  items: {
    ticker: string;
    name: string | null;
    priceUsd: number | null;
    changePct: number | null;
    chartCloses: number[];
  }[];
  max: number;
}> {
  const tickers = await listWatchlistTickers(db, userId);
  const prices = priceMap ?? (await fetchPrices(tickers));

  const items = tickers.map((ticker) => {
    const upper = ticker.trim().toUpperCase();
    return {
      ticker: upper,
      name: null,
      priceUsd: prices[upper] ?? null,
      changePct: null,
      chartCloses: [] as number[],
    };
  });

  return { items, max: 4 };
}
