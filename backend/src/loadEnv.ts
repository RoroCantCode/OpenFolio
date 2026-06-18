import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Single backend root — all env files live here (Render Root Directory: backend). */
const backendRoot = path.resolve(__dirname, "..");

const ENV_FILES = [
  path.join(backendRoot, ".env"),
  path.join(backendRoot, "atlas-credentials.env"),
] as const;

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function applyEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Load .env and atlas-credentials.env from the backend root (never commit those files). */
export function loadServerEnv(): void {
  for (const file of ENV_FILES) {
    applyEnvFile(file);
  }
  if (process.env.MONGODB_URI && !process.env.OPENFOLIO_MONGO_URI) {
    process.env.OPENFOLIO_MONGO_URI = process.env.MONGODB_URI;
  }
}

export function resolveMongoUri(): string {
  loadServerEnv();
  return process.env.OPENFOLIO_MONGO_URI ?? "mongodb://localhost:27017";
}

export function resolveMongoDbName(): string {
  loadServerEnv();
  return process.env.OPENFOLIO_MONGO_DB ?? "openfolio";
}

export function resolveBackendRoot(): string {
  return backendRoot;
}
