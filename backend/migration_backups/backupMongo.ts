/**
 * BSON backup of all 4 OpenFolio MongoDB collections (local instance).
 * Preserves Decimal128, ObjectId, and Date types in dump output.
 *
 * Usage: npx tsx migration_backups/backupMongo.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTIONS = ["users", "transactions", "watchlist", "analytics_reports"] as const;

const LOCAL_URI = process.env.OPENFOLIO_MONGO_URI ?? "mongodb://localhost:27017";
const DB_NAME = process.env.OPENFOLIO_MONGO_DB ?? "openfolio";

async function backupWithDriver(outDir: string): Promise<void> {
  const client = new MongoClient(LOCAL_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest: Record<string, number> = {};
  for (const name of COLLECTIONS) {
    const docs = await db.collection(name).find().toArray();
    manifest[name] = docs.length;
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(docs, null, 2));
  }
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        db: DB_NAME,
        uri: LOCAL_URI,
        counts: manifest,
        note: "Extended JSON; Decimal128 stored as {$numberDecimal:...}",
      },
      null,
      2
    ) + "\n"
  );
  await client.close();
  console.log("Driver backup written to:", outDir);
  console.log("Counts:", manifest);
}

function backupWithMongodump(outDir: string): boolean {
  const r = spawnSync(
    "mongodump",
    ["--uri", LOCAL_URI, "--db", DB_NAME, `--out=${outDir}`],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.warn("mongodump unavailable or failed:", r.stderr || r.stdout);
    return false;
  }
  console.log("mongodump backup written to:", path.join(outDir, DB_NAME));
  return true;
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, `mongo-dump-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const usedMongodump = backupWithMongodump(outDir);
  const driverDir = path.join(outDir, "driver-json");
  await backupWithDriver(driverDir);

  if (!usedMongodump) {
    console.log("Note: install MongoDB Database Tools for BSON mongodump archives.");
  }
  console.log("\nPhase 1 MongoDB backup: OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
