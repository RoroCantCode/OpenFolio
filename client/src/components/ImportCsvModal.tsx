import { useCallback, useRef, useState } from "react";
import type { CsvImportPreview } from "../api";
import { postTransactionsImportCommit, postTransactionsImportPreview } from "../api";

const SAMPLE_CSV = `date,ticker,side,quantity,price_usd,fx_sgd_per_usd,name,capital,fees_usd,notes
2024-01-15,AAPL,buy,10,185.50,1.3400,Apple,dbs,0,
2024-06-01,MSFT,sell,5,420.00,1.3600,Microsoft,,1.50,trim position`;

export function ImportCsvModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  const reset = useCallback(() => {
    setCsv("");
    setPreview(null);
    setErr(null);
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    setErr(null);
    setPreview(null);
    const text = await file.text();
    setCsv(text);
  };

  const runPreview = async () => {
    if (!csv.trim()) {
      setErr("Choose a CSV file or paste CSV text first.");
      return;
    }
    setBusy("preview");
    setErr(null);
    try {
      const p = await postTransactionsImportPreview(csv);
      setPreview(p);
    } catch (e) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  };

  const runCommit = async () => {
    if (!preview?.ledgerOk) return;
    if (!window.confirm(`Import ${preview.rowCount} transaction${preview.rowCount === 1 ? "" : "s"} into your ledger?`)) {
      return;
    }
    setBusy("commit");
    setErr(null);
    try {
      const { inserted } = await postTransactionsImportCommit(csv);
      onImported();
      handleClose();
      window.alert(`Imported ${inserted} transaction${inserted === 1 ? "" : "s"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const busyAny = busy !== null;

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
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
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
          <div style={{ fontSize: 18, fontWeight: 650 }}>Import transactions (CSV)</div>
          <button type="button" className="btn-ghost" onClick={handleClose} style={{ padding: "6px 10px" }}>
            Close
          </button>
        </div>

        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>
          Required columns: <span className="mono">date, ticker, side, quantity, price_usd, fx_sgd_per_usd</span>.
          Optional: <span className="mono">name, capital, fees_usd, notes, time_utc</span>. For buys,{" "}
          <span className="mono">capital</span> is <span className="mono">dbs</span>, <span className="mono">gift</span>, or{" "}
          <span className="mono">recycled</span>. Rows are appended to your existing ledger.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
            }}
          />
          <button type="button" className="btn-ghost" disabled={busyAny} onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
          <button type="button" className="btn-primary" disabled={busyAny || !csv.trim()} onClick={() => void runPreview()}>
            {busy === "preview" ? "Validating…" : "Preview import"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busyAny}
            onClick={() => {
              setCsv(SAMPLE_CSV);
              setPreview(null);
              setErr(null);
            }}
          >
            Load sample
          </button>
        </div>

        <textarea
          rows={5}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder="Paste CSV here…"
          style={{ marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        />

        {preview && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>{preview.rowCount}</strong> row{preview.rowCount === 1 ? "" : "s"} parsed.
              {preview.ledgerOk ? (
                <span style={{ color: "var(--ok)", marginLeft: 8 }}>Ledger validation passed.</span>
              ) : (
                <span style={{ color: "var(--danger)", marginLeft: 8 }}>
                  Ledger check failed: {preview.ledgerError}
                </span>
              )}
            </div>
            <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--stroke)" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Ticker</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>FX</th>
                    <th>Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((r) => (
                    <tr key={r.rowIndex}>
                      <td className="mono">{r.rowIndex}</td>
                      <td className="mono">{r.occurredAt.slice(0, 10)}</td>
                      <td className="mono">{r.ticker}</td>
                      <td>{r.side}</td>
                      <td className="mono">{r.quantity}</td>
                      <td className="mono">{r.priceUsd}</td>
                      <td className="mono">{r.fxSgdPerUsd}</td>
                      <td className="mono">{r.fundingSource}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rowCount > 50 && (
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Showing first 50 rows.</p>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={!preview.ledgerOk || busyAny}
              style={{ marginTop: 14 }}
              onClick={() => void runCommit()}
            >
              {busy === "commit" ? "Importing…" : `Import ${preview.rowCount} rows`}
            </button>
          </div>
        )}

        {err && (
          <div className="banner-error" style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
