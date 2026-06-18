import { nanoid } from "nanoid";
import { connectDb, closeDb, getDb } from "./db.js";
import { SEED_OWNER_ID } from "./migrate.js";
import { countUserTransactions, insertTransactionsBatch } from "./mongo/transactions.js";

type SeedTx = {
  occurred_at: string;
  side: "buy" | "sell";
  ticker: string;
  name: string | null;
  quantity: number;
  price_usd: number;
  fx_sgd_per_usd: number;
  funding_source: "dbs" | "bonus" | "proceeds" | "unspecified";
  fees_usd: number;
  notes: string | null;
};

const SEED: SeedTx[] = [
  {
    occurred_at: "2023-06-01T12:00:00.000Z",
    side: "buy",
    ticker: "TSLA",
    name: "Tesla",
    quantity: 19,
    price_usd: 164.52,
    fx_sgd_per_usd: 1.35,
    funding_source: "dbs",
    fees_usd: 0,
    notes: "Seed: illustrative lot",
  },
  {
    occurred_at: "2023-07-10T12:00:00.000Z",
    side: "buy",
    ticker: "GOOG",
    name: "Alphabet",
    quantity: 33,
    price_usd: 106.07,
    fx_sgd_per_usd: 1.35,
    funding_source: "bonus",
    fees_usd: 0,
    notes: "Seed",
  },
  {
    occurred_at: "2023-08-05T12:00:00.000Z",
    side: "buy",
    ticker: "NVDA",
    name: "NVIDIA",
    quantity: 55,
    price_usd: 27.75,
    fx_sgd_per_usd: 1.35,
    funding_source: "dbs",
    fees_usd: 0,
    notes: "Seed",
  },
];

async function main(): Promise<void> {
  await connectDb();
  const db = getDb();
  const n = await countUserTransactions(db, SEED_OWNER_ID);
  if (n > 0) {
    console.log("Database already has transactions; skipping seed.");
    await closeDb();
    return;
  }
  const batch = SEED.map((row) => ({ legacyId: nanoid(), ...row }));
  const inserted = await insertTransactionsBatch(db, SEED_OWNER_ID, batch);
  console.log(`Seeded ${inserted} transactions.`);
  await closeDb();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
