import type { Db } from "mongodb";
import type { TransactionRow } from "./portfolio.js";
import { buildPortfolio } from "./portfolio.js";
import { fetchPrices, fetchUsdSgdLive } from "./prices.js";
import { loadWatchlistPayload } from "./watchlistPayload.js";
import { listUserTransactions } from "./mongo/transactions.js";

/**
 * Single JSON snapshot of Home + Breakdown + Ledger + watchlist data for Gemini prompts.
 */
export async function buildAnalyticsBundle(
  db: Db,
  userId: string
): Promise<{
  generatedAt: string;
  capital: unknown;
  positions: unknown[];
  prices: Record<string, number | null>;
  liveFxSgdPerUsd: number | null;
  transactions: TransactionRow[];
  watchlist: { items: unknown[]; max: number };
}> {
  const rows = await listUserTransactions(db, userId);
  const tickers = [...new Set(rows.map((r) => r.ticker.trim().toUpperCase()))];
  const [prices, liveFxSgdPerUsd, watchlist] = await Promise.all([
    fetchPrices(tickers),
    fetchUsdSgdLive(),
    loadWatchlistPayload(db, userId),
  ]);
  const { positions, capital } = buildPortfolio(rows, prices);
  return {
    generatedAt: new Date().toISOString(),
    capital,
    positions,
    prices,
    liveFxSgdPerUsd,
    transactions: rows,
    watchlist,
  };
}
