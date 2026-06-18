/**
 * Phase 1: WAL-safe SQLite backup via `sqlite3` CLI VACUUM INTO.
 * Opens source read-only (file:...?mode=ro); never modifies the source file.
 *
 * Usage: npx tsx migration_backups/phase1_backup.ts
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const sourcePath =
  process.env.OPENFOLIO_DB ?? path.join(backendRoot, "data", "openfolio.sqlite");

const TABLES = [
  "users",
  "transactions",
  "watchlist",
  "analytics_reports",
  "_openfolio_migrations",
] as const;

function sqlite3(dbPath: string, sql: string, readonly = false): string {
  const uri = readonly ? `file:${dbPath}?mode=ro` : dbPath;
  const r = spawnSync("sqlite3", [uri, sql], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `sqlite3 failed for ${dbPath}`);
  }
  return (r.stdout ?? "").trim();
}

function countTable(dbPath: string, table: string): number {
  return Number(sqlite3(dbPath, `SELECT COUNT(*) FROM ${table};`, true));
}

function countAll(dbPath: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = countTable(dbPath, t);
  return out;
}

function sha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main(): void {
  if (!fs.existsSync(sourcePath)) {
    console.error(`HALT: source database not found at ${sourcePath}`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(__dirname, `openfolio_${stamp}.sqlite`);
  const backupSql = backupPath.replace(/'/g, "''");

  console.log("Source:", sourcePath);
  console.log("Backup:", backupPath);
  console.log("Method: sqlite3 VACUUM INTO (read-only source URI)");

  const sourceCounts = countAll(sourcePath);
  console.log("\nSource row counts:", JSON.stringify(sourceCounts, null, 2));

  sqlite3(`file:${sourcePath}?mode=ro`, `VACUUM INTO '${backupSql}';`);

  if (!fs.existsSync(backupPath)) {
    console.error("HALT: backup file was not created.");
    process.exit(1);
  }

  sqlite3(backupPath, "SELECT 1;", true);
  const backupCounts = countAll(backupPath);
  console.log("\nBackup row counts:", JSON.stringify(backupCounts, null, 2));

  let mismatch = false;
  console.log("\nReconciliation:");
  console.log("| Table | Source | Backup | Match |");
  console.log("|-------|--------|--------|-------|");
  for (const t of TABLES) {
    const s = sourceCounts[t];
    const b = backupCounts[t];
    const ok = s === b;
    if (!ok) mismatch = true;
    console.log(`| ${t} | ${s} | ${b} | ${ok ? "YES" : "NO"} |`);
  }

  const digest = sha256(backupPath);
  const size = fs.statSync(backupPath).size;

  const manifest = {
    createdAt: new Date().toISOString(),
    method: "sqlite3 VACUUM INTO (source opened read-only)",
    sourcePath,
    backupPath,
    sizeBytes: size,
    sha256: digest,
    sourceCounts,
    backupCounts,
    verified: !mismatch,
  };
  const manifestPath = `${backupPath}.manifest.json`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log("\nBackup file size (bytes):", size);
  console.log("SHA-256:", digest);
  console.log("Manifest:", manifestPath);

  if (mismatch) {
    console.error("\nHALT: row count mismatch between source and backup.");
    process.exit(1);
  }

  console.log("\nPhase 1 backup: VERIFIED OK");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
