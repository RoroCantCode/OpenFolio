import type { TransactionRow } from "./portfolio.js";

function buyCashOutUsd(q: number, price: number, fees: number): number {
  return q * price + fees;
}

function sellCashInUsd(q: number, price: number, fees: number): number {
  return q * price - fees;
}

export function validateLedger(
  rows: TransactionRow[]
): { ok: true } | { ok: false; message: string } {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  const map = new Map<string, number>();
  for (const tx of sorted) {
    const t = tx.ticker.trim().toUpperCase();
    let sh = map.get(t) ?? 0;
    if (tx.side === "buy") sh += tx.quantity;
    else sh -= tx.quantity;
    if (sh < -1e-9) {
      return {
        ok: false,
        message: "Sell quantity exceeds available shares at that date (check order and amounts).",
      };
    }
    map.set(t, sh);
  }
  return { ok: true };
}

/**
 * Ensures cumulative recycled (proceeds-funded) buy spend never exceeds cumulative sale proceeds,
 * in chronological order. Used when saving a buy funded from recycled capital.
 */
export function validateRecycledFunding(
  rows: TransactionRow[]
): { ok: true } | { ok: false; message: string } {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  let recoveredUsd = 0;
  let recycledUsd = 0;
  for (const tx of sorted) {
    if (tx.side === "sell") {
      recoveredUsd += sellCashInUsd(tx.quantity, tx.price_usd, tx.fees_usd);
      continue;
    }
    const out = buyCashOutUsd(tx.quantity, tx.price_usd, tx.fees_usd);
    if (tx.funding_source === "proceeds") {
      if (recycledUsd + out > recoveredUsd + 1e-6) {
        return {
          ok: false,
          message:
            "Recycled capital is not enough for this purchase (sale proceeds already fully allocated). Use Personal Capital instead.",
        };
      }
      recycledUsd += out;
    }
  }
  return { ok: true };
}
