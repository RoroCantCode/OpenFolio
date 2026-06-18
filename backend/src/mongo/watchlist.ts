import type { Db } from "mongodb";
import { resolveUserObjectId } from "./transactions.js";
import type { WatchlistDoc } from "./types.js";

export async function listWatchlistTickers(db: Db, legacyUserId: string): Promise<string[]> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const docs = await db
    .collection<WatchlistDoc>("watchlist")
    .find({ user_id: userOid })
    .sort({ sort_order: 1 })
    .toArray();
  return docs.map((d) => d.ticker);
}

export async function replaceWatchlist(db: Db, legacyUserId: string, tickers: string[]): Promise<void> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const col = db.collection("watchlist");
  await col.deleteMany({ user_id: userOid });
  if (tickers.length === 0) return;
  await col.insertMany(
    tickers.map((ticker, sort_order) => ({
      user_id: userOid,
      ticker,
      sort_order,
    }))
  );
}
