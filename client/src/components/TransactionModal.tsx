import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TransactionRow } from "../api";
import { fetchTradeDateQuote, patchTransaction, postTransaction } from "../api";
import { fmtUsd } from "../format";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
      {label}
      {children}
    </label>
  );
}

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdFromIso(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : todayLocalYmd();
}

function fundingFromRow(row: TransactionRow): "dbs" | "proceeds" | "bonus" {
  if (row.funding_source === "proceeds") return "proceeds";
  if (row.funding_source === "bonus") return "bonus";
  return "dbs";
}

export function TransactionModal({
  open,
  onClose,
  onSaved,
  editRow = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editRow?: TransactionRow | null;
}) {
  const isEdit = Boolean(editRow);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [tradeDate, setTradeDate] = useState(todayLocalYmd);
  const [funding, setFunding] = useState<"dbs" | "proceeds" | "bonus">("dbs");
  const [fees, setFees] = useState("0");
  const [notes, setNotes] = useState("");
  const [priceUsdStr, setPriceUsdStr] = useState("");
  const [fxStr, setFxStr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    priceUsd: number;
    fxSgdPerUsd: number;
    occurredAt: string;
    priceBarUtc: string;
    fxBarUtc: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setQuoteErr(null);
    setQuote(null);
    if (editRow) {
      setSide(editRow.side);
      setTicker(editRow.ticker);
      setName(editRow.name ?? "");
      setQty(String(editRow.quantity));
      setTradeDate(ymdFromIso(editRow.occurred_at));
      setFunding(fundingFromRow(editRow));
      setFees(String(editRow.fees_usd));
      setNotes(editRow.notes ?? "");
      setPriceUsdStr(String(editRow.price_usd));
      setFxStr(String(editRow.fx_sgd_per_usd));
    } else {
      setTradeDate(todayLocalYmd());
      setTicker("");
      setName("");
      setQty("1");
      setFees("0");
      setNotes("");
      setSide("buy");
      setFunding("dbs");
      setPriceUsdStr("");
      setFxStr("");
    }
  }, [open, editRow]);

  const loadQuote = useCallback(
    async (opts?: { manual?: boolean }) => {
      const manual = opts?.manual ?? false;
      const t = ticker.trim().toUpperCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
        setQuote(null);
        setQuoteErr(manual ? "Use a valid trade date (YYYY-MM-DD)." : null);
        setQuoteLoading(false);
        return;
      }
      if (!t) {
        setQuote(null);
        setQuoteErr(manual ? "Enter a ticker to load price and USD/SGD." : null);
        setQuoteLoading(false);
        return;
      }
      setQuoteLoading(true);
      setQuoteErr(null);
      try {
        const q = await fetchTradeDateQuote(t, tradeDate);
        setQuote({
          priceUsd: q.priceUsd,
          fxSgdPerUsd: q.fxSgdPerUsd,
          occurredAt: q.occurredAt,
          priceBarUtc: q.priceBarUtc,
          fxBarUtc: q.fxBarUtc,
        });
        setPriceUsdStr(String(q.priceUsd));
        setFxStr(String(q.fxSgdPerUsd));
      } catch (e) {
        setQuote(null);
        setQuoteErr(e instanceof Error ? e.message : "Could not load market data.");
      } finally {
        setQuoteLoading(false);
      }
    },
    [ticker, tradeDate]
  );

  useEffect(() => {
    if (!open || isEdit) return;
    const id = window.setTimeout(() => void loadQuote(), 450);
    return () => window.clearTimeout(id);
  }, [open, isEdit, ticker, tradeDate, loadQuote]);

  if (!open) return null;

  const priceUsd = Number(priceUsdStr);
  const fxSgdPerUsd = Number(fxStr);
  const quantity = Number(qty);
  const priceOk = Number.isFinite(priceUsd) && priceUsd >= 0;
  const fxOk = Number.isFinite(fxSgdPerUsd) && fxSgdPerUsd > 0;
  const qtyOk = Number.isFinite(quantity) && quantity > 0;

  const canSubmit = isEdit
    ? priceOk && fxOk && qtyOk && ticker.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
    : Boolean(quote && !quoteLoading && !quoteErr && qtyOk);

  const occurredAt = isEdit
    ? `${tradeDate}T12:00:00.000Z`
    : quote?.occurredAt;

  const submit = async () => {
    if (!canSubmit || occurredAt == null) return;
    setErr(null);
    setLoading(true);
    try {
      const body = {
        occurredAt,
        side,
        ticker: ticker.trim().toUpperCase(),
        name: name.trim() || null,
        quantity,
        priceUsd,
        fxSgdPerUsd,
        fundingSource: side === "buy" ? funding : undefined,
        feesUsd: Number(fees) || 0,
        notes: notes.trim() || null,
      };
      if (isEdit && editRow) {
        await patchTransaction(editRow.id, body);
      } else {
        await postTransaction(body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setLoading(false);
    }
  };

  const maxDate = todayLocalYmd();
  const fundingOptions: { value: "dbs" | "proceeds" | "bonus"; label: string }[] = [
    { value: "dbs", label: "Personal Capital" },
    { value: "proceeds", label: "Recycled Capital" },
    { value: "bonus", label: "Gift / bonus" },
  ];

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(92vh, 900px)",
          overflowY: "auto",
          background: "var(--bg1)",
          border: "1px solid var(--stroke)",
          borderRadius: 18,
          padding: "1.25rem",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 650 }}>{isEdit ? "Edit transaction" : "New transaction"}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "6px 10px",
            }}
          >
            Close
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
          {isEdit
            ? "Update trade details. Use Refresh to pull Yahoo closes for the trade date, or edit price and FX directly."
            : "Set the trade date and ticker. Price and USD/SGD use the last available daily close on or before that day."}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid " + (side === s ? "rgba(94,234,212,0.45)" : "var(--stroke)"),
                background: side === s ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.03)",
                color: "var(--text)",
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <Field label="Trade date">
            <input
              type="date"
              value={tradeDate}
              min="1990-01-01"
              max={maxDate}
              onChange={(e) => setTradeDate(e.target.value)}
            />
          </Field>
          <Field label="Ticker">
            <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="TSLA" />
          </Field>
          <Field label="Name (optional)">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tesla" />
          </Field>
          <Field label="Quantity">
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
          </Field>

          <div
            style={{
              borderRadius: 12,
              border: "1px solid var(--stroke)",
              background: "rgba(255,255,255,0.03)",
              padding: "12px 14px",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                {isEdit ? "Price & FX" : "Market fill (read-only)"}
              </span>
              <button
                type="button"
                onClick={() => void loadQuote({ manual: true })}
                style={{
                  padding: "6px 10px",
                  fontSize: 12,
                  borderRadius: 10,
                  border: "1px solid var(--stroke)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text)",
                }}
              >
                Refresh
              </button>
            </div>
            {quoteLoading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading price and USD/SGD…</div>}
            {isEdit ? (
              <div style={{ display: "grid", gap: 10 }}>
                <Field label="Price (USD / share)">
                  <input value={priceUsdStr} onChange={(e) => setPriceUsdStr(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="SGD per USD">
                  <input value={fxStr} onChange={(e) => setFxStr(e.target.value)} inputMode="decimal" />
                </Field>
              </div>
            ) : (
              !quoteLoading &&
              quote && (
                <>
                  <div className="mono" style={{ fontSize: 16 }}>
                    Price (USD / share): <strong style={{ color: "var(--text)" }}>{fmtUsd(quote.priceUsd, 2)}</strong>
                  </div>
                  <div className="mono" style={{ fontSize: 16 }}>
                    SGD per USD: <strong style={{ color: "var(--text)" }}>{quote.fxSgdPerUsd.toFixed(4)}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                    Share bar (UTC): {new Date(quote.priceBarUtc).toLocaleString()} · FX bar (UTC):{" "}
                    {new Date(quote.fxBarUtc).toLocaleString()}
                  </div>
                </>
              )
            )}
            {!isEdit && !quoteLoading && !quote && !quoteErr && ticker.trim().length > 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Adjust ticker or date to load quotes.</div>
            )}
            {isEdit && quote && !quoteLoading && (
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                Last refresh: {fmtUsd(quote.priceUsd, 2)} · {quote.fxSgdPerUsd.toFixed(4)} SGD/USD (Yahoo)
              </div>
            )}
          </div>

          <Field label="Fees (USD)">
            <input value={fees} onChange={(e) => setFees(e.target.value)} inputMode="decimal" />
          </Field>
          {side === "buy" && (
            <Field label="Funding">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {fundingOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFunding(opt.value)}
                    style={{
                      flex: "1 1 120px",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border:
                        "1px solid " + (funding === opt.value ? "rgba(94,234,212,0.45)" : "var(--stroke)"),
                      background:
                        funding === opt.value ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.03)",
                      color: "var(--text)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Notes">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        {quoteErr && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(251,113,133,0.12)",
              border: "1px solid rgba(251,113,133,0.35)",
              color: "#fecdd3",
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {quoteErr}
          </div>
        )}

        {err && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(251,113,133,0.12)",
              border: "1px solid rgba(251,113,133,0.35)",
              color: "#fecdd3",
              fontSize: 14,
            }}
          >
            {err}
          </div>
        )}

        <button
          type="button"
          disabled={loading || !canSubmit}
          onClick={() => void submit()}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "none",
            fontWeight: 650,
            background: canSubmit ? "linear-gradient(135deg, #5eead4, #7c9cff)" : "rgba(255,255,255,0.12)",
            color: canSubmit ? "#041016" : "var(--muted)",
          }}
        >
          {loading ? "Saving…" : isEdit ? "Save changes" : !quote ? "Resolve price & FX to save" : "Save transaction"}
        </button>
      </div>
    </div>
  );
}
