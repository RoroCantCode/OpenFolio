/**
 * One-time import of Transaction History spreadsheet rows into MongoDB.
 *
 *   npm run import:history -- --force
 */

import { nanoid } from "nanoid";
import { connectDb, closeDb, getDb } from "./db.js";
import { SEED_OWNER_ID } from "./migrate.js";
import {
  countUserTransactions,
  deleteAllUserTransactions,
  insertTransactionsBatch,
} from "./mongo/transactions.js";

type Capital = "gift" | "dbs" | "recycled" | "sale";
type Side = "buy" | "sell";

type Row = {
  name: string;
  ticker: string;
  date: string;
  timeUtc: string;
  priceUsd: number;
  fxSgdPerUsd: number;
  qty: number;
  side: Side;
  capital: Capital;
};

const ROWS: Row[] = [
  { name: "Tesla", ticker: "TSLA", date: "2022-12-13", timeUtc: "12:00:00", priceUsd: 160.95, fxSgdPerUsd: 1.34679, qty: 16, side: "buy", capital: "gift" },
  { name: "Snowflake", ticker: "SNOW", date: "2022-12-13", timeUtc: "12:01:00", priceUsd: 150.58, fxSgdPerUsd: 1.34679, qty: 16, side: "buy", capital: "gift" },
  { name: "Tesla", ticker: "TSLA", date: "2023-04-20", timeUtc: "12:00:00", priceUsd: 162.99, fxSgdPerUsd: 1.3317, qty: 7, side: "buy", capital: "dbs" },
  { name: "Alphabet", ticker: "GOOG", date: "2023-04-24", timeUtc: "12:00:00", priceUsd: 106.78, fxSgdPerUsd: 1.3323, qty: 23, side: "buy", capital: "gift" },
  { name: "Tesla", ticker: "TSLA", date: "2023-04-26", timeUtc: "12:00:00", priceUsd: 153.75, fxSgdPerUsd: 1.33445, qty: 7, side: "buy", capital: "dbs" },
  { name: "Alphabet", ticker: "GOOG", date: "2023-04-26", timeUtc: "12:01:00", priceUsd: 104.45, fxSgdPerUsd: 1.33445, qty: 10, side: "buy", capital: "dbs" },
  { name: "NVIDIA", ticker: "NVDA", date: "2023-04-28", timeUtc: "12:00:00", priceUsd: 27.75, fxSgdPerUsd: 1.335, qty: 90, side: "buy", capital: "gift" },
  { name: "Snowflake", ticker: "SNOW", date: "2023-05-30", timeUtc: "12:00:00", priceUsd: 158.65, fxSgdPerUsd: 1.35079, qty: 5, side: "buy", capital: "dbs" },
  { name: "Amazon", ticker: "AMZN", date: "2023-06-09", timeUtc: "12:00:00", priceUsd: 123.43, fxSgdPerUsd: 1.3436, qty: 8, side: "buy", capital: "dbs" },
  { name: "Coinbase", ticker: "COIN", date: "2023-06-20", timeUtc: "12:00:00", priceUsd: 57.09, fxSgdPerUsd: 1.34313, qty: 1, side: "buy", capital: "gift" },
  { name: "Tesla", ticker: "TSLA", date: "2023-10-20", timeUtc: "12:00:00", priceUsd: 211.99, fxSgdPerUsd: 1.3729, qty: 6, side: "buy", capital: "dbs" },
  { name: "Microsoft", ticker: "MSFT", date: "2023-10-20", timeUtc: "12:01:00", priceUsd: 326.67, fxSgdPerUsd: 1.3729, qty: 4, side: "buy", capital: "dbs" },
  { name: "Tesla", ticker: "TSLA", date: "2024-03-15", timeUtc: "12:00:00", priceUsd: 163.57, fxSgdPerUsd: 1.3366, qty: 7, side: "buy", capital: "dbs" },
  { name: "Tesla", ticker: "TSLA", date: "2024-04-22", timeUtc: "12:00:00", priceUsd: 142.05, fxSgdPerUsd: 1.36196, qty: 6, side: "buy", capital: "dbs" },
  { name: "IonQ", ticker: "IONQ", date: "2024-12-19", timeUtc: "12:00:00", priceUsd: 37.76, fxSgdPerUsd: 1.3615, qty: 58, side: "buy", capital: "gift" },
  { name: "Tesla", ticker: "TSLA", date: "2024-12-27", timeUtc: "12:00:00", priceUsd: 431.66, fxSgdPerUsd: 1.3583, qty: 30, side: "sell", capital: "sale" },
  { name: "Snowflake", ticker: "SNOW", date: "2024-12-27", timeUtc: "12:05:00", priceUsd: 158.65, fxSgdPerUsd: 1.3583, qty: 5, side: "sell", capital: "sale" },
  { name: "NVIDIA", ticker: "NVDA", date: "2024-12-27", timeUtc: "12:10:00", priceUsd: 137.01, fxSgdPerUsd: 1.3583, qty: 35, side: "sell", capital: "sale" },
  { name: "Amazon", ticker: "AMZN", date: "2024-12-27", timeUtc: "12:20:00", priceUsd: 223.75, fxSgdPerUsd: 1.3583, qty: 28, side: "buy", capital: "recycled" },
  { name: "Coinbase", ticker: "COIN", date: "2024-12-27", timeUtc: "12:21:00", priceUsd: 265.71, fxSgdPerUsd: 1.3583, qty: 8, side: "buy", capital: "recycled" },
  { name: "Microsoft", ticker: "MSFT", date: "2024-12-27", timeUtc: "12:22:00", priceUsd: 430.53, fxSgdPerUsd: 1.3583, qty: 8, side: "buy", capital: "recycled" },
  { name: "Meta", ticker: "META", date: "2024-12-27", timeUtc: "12:23:00", priceUsd: 599.81, fxSgdPerUsd: 1.3583, qty: 11, side: "buy", capital: "recycled" },
  { name: "Crowdstrike", ticker: "CRWD", date: "2024-12-27", timeUtc: "12:24:00", priceUsd: 354.99, fxSgdPerUsd: 1.3583, qty: 7, side: "buy", capital: "gift" },
  { name: "Coinbase", ticker: "COIN", date: "2025-08-01", timeUtc: "12:00:00", priceUsd: 314.69, fxSgdPerUsd: 1.2894, qty: 4, side: "buy", capital: "dbs" },
];

function fundingDb(r: Row): "dbs" | "bonus" | "proceeds" | "unspecified" {
  if (r.side === "sell") return "unspecified";
  switch (r.capital) {
    case "dbs":
      return "dbs";
    case "gift":
      return "bonus";
    case "recycled":
      return "proceeds";
    default:
      return "unspecified";
  }
}

function occurredAtIso(r: Row): string {
  return `${r.date}T${r.timeUtc}.000Z`;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  await connectDb();
  const db = getDb();

  const count = await countUserTransactions(db, SEED_OWNER_ID);
  if (count > 0 && !force) {
    console.error(
      `Database already has ${count} transaction(s). Re-run with --force to replace ALL rows with this historical import.`
    );
    await closeDb();
    process.exit(1);
  }

  if (force) {
    const deleted = await deleteAllUserTransactions(db, SEED_OWNER_ID);
    console.log(`Cleared ${deleted} existing transactions for seed owner (--force).`);
  }

  const notes = "Imported from Transaction History spreadsheet";
  const batch = ROWS.map((r) => ({
    legacyId: nanoid(),
    occurred_at: occurredAtIso(r),
    side: r.side,
    ticker: r.ticker.toUpperCase(),
    name: r.name,
    quantity: r.qty,
    price_usd: r.priceUsd,
    fx_sgd_per_usd: r.fxSgdPerUsd,
    funding_source: fundingDb(r),
    fees_usd: 0,
    notes,
  }));

  const inserted = await insertTransactionsBatch(db, SEED_OWNER_ID, batch);
  console.log(`Inserted ${inserted} transactions.`);
  await closeDb();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
