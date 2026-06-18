import type { TransactionRow } from "./portfolio.js";
import { validateLedger, validateRecycledFunding } from "./validate.js";

export type CsvImportRow = {
  rowIndex: number;
  occurredAt: string;
  side: "buy" | "sell";
  ticker: string;
  name: string | null;
  quantity: number;
  priceUsd: number;
  fxSgdPerUsd: number;
  fundingSource: TransactionRow["funding_source"];
  feesUsd: number;
  notes: string | null;
};

export type CsvParseResult =
  | { ok: true; rows: CsvImportRow[] }
  | { ok: false; errors: string[] };

const HEADER_ALIASES: Record<string, keyof ParsedCells> = {
  date: "date",
  trade_date: "date",
  occurred_at: "date",
  ticker: "ticker",
  symbol: "ticker",
  side: "side",
  type: "side",
  quantity: "quantity",
  qty: "quantity",
  shares: "quantity",
  price_usd: "priceUsd",
  price: "priceUsd",
  priceusd: "priceUsd",
  fx_sgd_per_usd: "fxSgdPerUsd",
  fx: "fxSgdPerUsd",
  fxsgdperusd: "fxSgdPerUsd",
  name: "name",
  capital: "capital",
  funding: "capital",
  funding_source: "capital",
  fees_usd: "feesUsd",
  fees: "feesUsd",
  notes: "notes",
  time_utc: "timeUtc",
  time: "timeUtc",
};

type ParsedCells = {
  date: string;
  ticker: string;
  side: string;
  quantity: string;
  priceUsd: string;
  fxSgdPerUsd: string;
  name: string;
  capital: string;
  feesUsd: string;
  notes: string;
  timeUtc: string;
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Minimal RFC-style CSV row parser (handles quoted commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function mapCapital(
  raw: string,
  side: "buy" | "sell"
): TransactionRow["funding_source"] | { error: string } {
  if (side === "sell") return "unspecified";
  const c = raw.trim().toLowerCase();
  if (!c) return "dbs";
  if (c === "dbs" || c === "personal") return "dbs";
  if (c === "gift" || c === "bonus") return "bonus";
  if (c === "recycled" || c === "proceeds") return "proceeds";
  return { error: `Unknown capital "${raw}" (use dbs, gift, or recycled for buys).` };
}

function parseSide(raw: string): "buy" | "sell" | null {
  const s = raw.trim().toLowerCase();
  if (s === "buy" || s === "b") return "buy";
  if (s === "sell" || s === "s") return "sell";
  return null;
}

function parseDateYmd(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const mm = String(Number(m[1])).padStart(2, "0");
    const dd = String(Number(m[2])).padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return null;
}

function occurredAtIso(dateYmd: string, timeUtc: string): string {
  const time = /^\d{2}:\d{2}(:\d{2})?$/.test(timeUtc.trim())
    ? timeUtc.trim().length === 5
      ? `${timeUtc.trim()}:00`
      : timeUtc.trim()
    : "12:00:00";
  return `${dateYmd}T${time}.000Z`;
}

export function parseTransactionsCsv(csvText: string): CsvParseResult {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { ok: false, errors: ["CSV must include a header row and at least one data row."] };
  }

  const headerCells = parseCsvLine(lines[0]!);
  const colMap = new Map<number, keyof ParsedCells>();
  const unknownHeaders: string[] = [];

  for (let i = 0; i < headerCells.length; i++) {
    const key = HEADER_ALIASES[normalizeHeader(headerCells[i] ?? "")];
    if (key) colMap.set(i, key);
    else if ((headerCells[i] ?? "").trim()) unknownHeaders.push(headerCells[i]!);
  }

  const required: (keyof ParsedCells)[] = ["date", "ticker", "side", "quantity", "priceUsd", "fxSgdPerUsd"];
  const present = new Set(colMap.values());
  const missing = required.filter((k) => !present.has(k));
  if (missing.length) {
    return {
      ok: false,
      errors: [
        `Missing required column(s): ${missing.join(", ")}.`,
        "Required: date, ticker, side, quantity, price_usd, fx_sgd_per_usd.",
        unknownHeaders.length ? `Unrecognized headers ignored: ${unknownHeaders.join(", ")}.` : "",
      ].filter(Boolean),
    };
  }

  const rows: CsvImportRow[] = [];
  const errors: string[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]!);
    const rowIndex = li + 1;
    const parsed: Partial<ParsedCells> = {};
    for (const [idx, key] of colMap) {
      parsed[key] = cells[idx] ?? "";
    }

    const dateYmd = parseDateYmd(parsed.date ?? "");
    if (!dateYmd) {
      errors.push(`Row ${rowIndex}: invalid date "${parsed.date ?? ""}" (use YYYY-MM-DD).`);
      continue;
    }

    const side = parseSide(parsed.side ?? "");
    if (!side) {
      errors.push(`Row ${rowIndex}: invalid side "${parsed.side ?? ""}" (use buy or sell).`);
      continue;
    }

    const ticker = (parsed.ticker ?? "").trim().toUpperCase();
    if (!ticker) {
      errors.push(`Row ${rowIndex}: ticker is required.`);
      continue;
    }

    const quantity = Number(parsed.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`Row ${rowIndex}: quantity must be a positive number.`);
      continue;
    }

    const priceUsd = Number(parsed.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd < 0) {
      errors.push(`Row ${rowIndex}: price_usd must be a non-negative number.`);
      continue;
    }

    const fxSgdPerUsd = Number(parsed.fxSgdPerUsd);
    if (!Number.isFinite(fxSgdPerUsd) || fxSgdPerUsd <= 0) {
      errors.push(`Row ${rowIndex}: fx_sgd_per_usd must be a positive number.`);
      continue;
    }

    const feesUsd = parsed.feesUsd?.trim() ? Number(parsed.feesUsd) : 0;
    if (!Number.isFinite(feesUsd) || feesUsd < 0) {
      errors.push(`Row ${rowIndex}: fees_usd must be a non-negative number.`);
      continue;
    }

    const cap = mapCapital(parsed.capital ?? "", side);
    if (typeof cap === "object" && "error" in cap) {
      errors.push(`Row ${rowIndex}: ${cap.error}`);
      continue;
    }

    rows.push({
      rowIndex,
      occurredAt: occurredAtIso(dateYmd, parsed.timeUtc ?? "12:00:00"),
      side,
      ticker,
      name: (parsed.name ?? "").trim() || null,
      quantity,
      priceUsd,
      fxSgdPerUsd,
      fundingSource: cap,
      feesUsd,
      notes: (parsed.notes ?? "").trim() || null,
    });
  }

  if (errors.length) return { ok: false, errors };
  if (rows.length === 0) return { ok: false, errors: ["No data rows found."] };
  if (rows.length > 500) return { ok: false, errors: ["Import limited to 500 rows per file."] };

  return { ok: true, rows };
}

export function validateImportAgainstLedger(
  existing: TransactionRow[],
  importRows: CsvImportRow[]
): { ok: true } | { ok: false; message: string } {
  const proposed: TransactionRow[] = importRows.map((r, i) => ({
    id: `__import_${i}__`,
    occurred_at: r.occurredAt,
    side: r.side,
    ticker: r.ticker,
    name: r.name,
    quantity: r.quantity,
    price_usd: r.priceUsd,
    fx_sgd_per_usd: r.fxSgdPerUsd,
    funding_source: r.fundingSource,
    fees_usd: r.feesUsd,
    notes: r.notes,
  }));
  const combined = [...existing, ...proposed];
  const v = validateLedger(combined);
  if (!v.ok) return v;
  return validateRecycledFunding(combined);
}

export function csvImportRowToTransactionRow(
  r: CsvImportRow,
  id: string
): TransactionRow {
  return {
    id,
    occurred_at: r.occurredAt,
    side: r.side,
    ticker: r.ticker,
    name: r.name,
    quantity: r.quantity,
    price_usd: r.priceUsd,
    fx_sgd_per_usd: r.fxSgdPerUsd,
    funding_source: r.fundingSource,
    fees_usd: r.feesUsd,
    notes: r.notes,
  };
}
