import { connectDb, getDb, closeDb } from "../src/db.js";
import { listUserTransactions } from "../src/mongo/transactions.js";
import { SEED_OWNER_ID } from "../src/migrate.js";

async function main(): Promise<void> {
  await connectDb();
  const n = await getDb().collection("transactions").countDocuments();
  const rows = await listUserTransactions(getDb(), SEED_OWNER_ID);
  const sample = rows[0];
  console.log("Atlas connected. transactions:", n);
  if (sample) {
    console.log("API row keys:", Object.keys(sample).sort().join(", "));
    console.log("quantity (number):", sample.quantity);
    console.log("id (legacy string):", sample.id);
  }
  await closeDb();
  console.log("Phase 3 backend validation: OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
