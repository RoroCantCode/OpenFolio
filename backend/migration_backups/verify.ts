/**
 * Phase 5: Parity verification — MongoDB reads vs SQLite backup snapshot.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { connectDb, closeDb, getDb } from "../src/db.js";
import { listUserTransactions } from "../src/mongo/transactions.js";
import { listWatchlistTickers } from "../src/mongo/watchlist.js";
import { buildPortfolio } from "../src/portfolio.js";
import { SEED_OWNER_ID } from "../src/migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(__dirname, "openfolio_2026-06-17T13-57-43Z.sqlite");
const MONGO_URI = process.env.OPENFOLIO_MONGO_URI ?? "mongodb://localhost:27017";
const MONGO_DB = process.env.OPENFOLIO_MONGO_DB ?? "openfolio";

function sqliteJson<T>(sql: string): T[] {
  const r = spawnSync("sqlite3", ["-readonly", BACKUP, "-json", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "sqlite query failed");
  const out = (r.stdout ?? "").trim();
  return out ? (JSON.parse(out) as T[]) : [];
}

async function main(): Promise<void> {
  console.log("=== Phase 5 verification ===\n");

  await connectDb();
  const db = getDb();

  const mongoTx = await listUserTransactions(db, SEED_OWNER_ID);
  const sqliteTx = sqliteJson<{ id: string; ticker: string; quantity: number }>(
    `SELECT id, ticker, quantity FROM transactions WHERE user_id = '${SEED_OWNER_ID}' ORDER BY occurred_at, id;`
  );

  console.log(`Transaction count — SQLite backup: ${sqliteTx.length}, MongoDB: ${mongoTx.length}`);
  console.log(mongoTx.length === sqliteTx.length ? "  COUNT MATCH: YES" : "  COUNT MATCH: NO");

  const sqliteIds = new Set(sqliteTx.map((r) => r.id));
  const mongoIds = new Set(mongoTx.map((r) => r.id));
  const idsMatch =
    sqliteIds.size === mongoIds.size && [...sqliteIds].every((id) => mongoIds.has(id));
  console.log(idsMatch ? "  Legacy id set MATCH: YES" : "  Legacy id set MATCH: NO");

  const wlMongo = await listWatchlistTickers(db, SEED_OWNER_ID);
  const wlSqlite = sqliteJson<{ ticker: string }>(
    `SELECT ticker FROM watchlist WHERE user_id = '${SEED_OWNER_ID}' ORDER BY sort_order;`
  ).map((r) => r.ticker.trim().toUpperCase());
  console.log(`\nWatchlist — SQLite: [${wlSqlite.join(", ")}]`);
  console.log(`Watchlist — MongoDB: [${wlMongo.join(", ")}]`);
  console.log(JSON.stringify(wlSqlite) === JSON.stringify(wlMongo) ? "  MATCH: YES" : "  MATCH: NO");

  const { positions, capital } = buildPortfolio(mongoTx, {});
  console.log(`\nPortfolio build from MongoDB transactions:`);
  console.log(`  open positions: ${positions.length}`);
  console.log(`  portfolio value (no live prices): ${capital.currentPortfolioValueUsd}`);
  console.log(`  cost basis: ${capital.totalInvestedCapitalUsd}`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const ping = await client.db(MONGO_DB).command({ ping: 1 });
  await client.close();
  console.log(`\nMongoDB ping: ${ping.ok === 1 ? "OK" : "FAIL"}`);

  await closeDb();

  const ok = mongoTx.length === sqliteTx.length && idsMatch && JSON.stringify(wlSqlite) === JSON.stringify(wlMongo);
  if (!ok) {
    console.error("\nVERIFICATION FAILED");
    process.exit(1);
  }
  console.log("\nPhase 5 verification: PASSED");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
