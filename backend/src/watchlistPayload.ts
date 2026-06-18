import type { Db } from "mongodb";
import { fetchUsdPrice } from "./prices.js";
import { fetchTwoWeekReturnPct } from "./momentum.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

export async function loadWatchlistPayload(
  db: Db,
  userId: string
): Promise<{
  items: { ticker: string; priceUsd: number | null; change2wPct: number | null }[];
  max: number;
}> {
  const tickers = await listWatchlistTickers(db, userId);
  const items = await Promise.all(
    tickers.map(async (ticker) => {
      const [priceUsd, change2wPct] = await Promise.all([fetchUsdPrice(ticker), fetchTwoWeekReturnPct(ticker)]);
      return { ticker, priceUsd, change2wPct };
    })
  );
  return { items, max: 4 };
}
