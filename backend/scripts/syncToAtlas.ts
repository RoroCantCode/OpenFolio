/**
 * One-time sync: local MongoDB -> MongoDB Atlas.
 * Copies raw BSON documents (preserves Decimal128, ObjectId, Date).
 *
 * Usage:
 *   npx tsx scripts/syncToAtlas.ts
 *   npx tsx scripts/syncToAtlas.ts --drop   # clear Atlas collections first
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadServerEnv } from "../src/loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_URI = process.env.OPENFOLIO_LOCAL_MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.OPENFOLIO_MONGO_DB ?? "openfolio";
const COLLECTIONS = ["users", "transactions", "watchlist", "analytics_reports"] as const;

async function ensureIndexes(db: import("mongodb").Db): Promise<void> {
  await db.collection("users").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { email: 1 }, unique: true },
  ]);
  await db.collection("transactions").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1 } },
    { key: { user_id: 1, occurred_at: 1, legacy_id: 1 } },
    { key: { ticker: 1 } },
  ]);
  await db.collection("watchlist").createIndexes([
    { key: { user_id: 1, ticker: 1 }, unique: true },
    { key: { user_id: 1, sort_order: 1 } },
  ]);
  await db.collection("analytics_reports").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1, kind: 1, created_at: -1 } },
  ]);
}

async function main(): Promise<void> {
  loadServerEnv();

  const atlasUri = process.env.OPENFOLIO_MONGO_URI ?? process.env.MONGODB_URI;
  if (!atlasUri || atlasUri.includes("localhost")) {
    console.error("HALT: Set MONGODB_URI in atlas-credentials.env (Atlas cluster).");
    process.exit(1);
  }

  console.log("Local:", `${LOCAL_URI}/${DB_NAME}`);
  console.log("Atlas:", `${atlasUri.replace(/\/\/[^@]+@/, "//***@")}/${DB_NAME}`);
  console.log("Mode: replace each Atlas collection with a full clone from local");

  const localClient = new MongoClient(LOCAL_URI);
  const atlasClient = new MongoClient(atlasUri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 15000,
  });

  await localClient.connect();
  await atlasClient.connect();

  const localDb = localClient.db(DB_NAME);
  const atlasDb = atlasClient.db(DB_NAME);

  console.log("\n| Collection | Local | Atlas (before) | Atlas (after) |");
  for (const name of COLLECTIONS) {
    const localCount = await localDb.collection(name).countDocuments();
    const before = await atlasDb.collection(name).countDocuments();

    await atlasDb.collection(name).deleteMany({});

    const docs = await localDb.collection(name).find().toArray();
    if (docs.length > 0) {
      await atlasDb.collection(name).insertMany(docs, { ordered: true });
    }

    const after = await atlasDb.collection(name).countDocuments();
    const ok = localCount === after ? "YES" : "NO";
    console.log(`| ${name} | ${localCount} | ${before} | ${after} | ${ok} |`);

    if (localCount !== after) {
      console.error(`HALT: count mismatch for ${name}`);
      process.exit(1);
    }
  }

  await ensureIndexes(atlasDb);

  // Referential spot-check: transaction user_id exists in users
  const userIds = (
    await atlasDb.collection("users").find({}, { projection: { _id: 1 } }).toArray()
  ).map((u) => u._id);
  const orphanTx = await atlasDb.collection("transactions").countDocuments({
    user_id: { $nin: userIds },
  });
  if (orphanTx > 0) {
    console.error(`HALT: ${orphanTx} transactions with unresolved user_id`);
    process.exit(1);
  }

  await localClient.close();
  await atlasClient.close();

  console.log("\nPhase 2 Atlas sync: VERIFIED OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
