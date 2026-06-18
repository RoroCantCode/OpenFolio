import { useMemo } from "react";
import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Position } from "../api";
import { useCurrency } from "../CurrencyContext";
import { fmtSgd, fmtUsd } from "../format";

const BLUE = "#60a5fa";
const RED = "#fb7185";

type Row = { ticker: string; weightedBuy: number; current?: number };

function PriceLabel(props: { x?: number; y?: number; value?: number | string }) {
  const { x, y, value } = props;
  if (x == null || y == null || value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return (
    <text
      x={x}
      y={y - 8}
      fill="var(--text)"
      fontSize={11}
      fontFamily="JetBrains Mono, ui-monospace, monospace"
      textAnchor="middle"
    >
      {n.toFixed(2)}
    </text>
  );
}

export function BuyVsCurrentChart({
  positions,
  chartOn,
  onToggleTicker,
  onSelectAll,
  onClearAll,
}: {
  positions: Position[];
  chartOn: Record<string, boolean>;
  onToggleTicker: (ticker: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const { currency, toDisplayFromUsd } = useCurrency();

  const rows: Row[] = useMemo(() => {
    return positions
      .filter((p) => chartOn[p.ticker] === true)
      .map((p) => ({
        ticker: p.ticker,
        weightedBuy: toDisplayFromUsd(p.avgCostUsd),
        ...(p.marketPriceUsd != null ? { current: toDisplayFromUsd(p.marketPriceUsd) } : {}),
      }));
  }, [positions, chartOn, toDisplayFromUsd]);

  const maxY = useMemo(() => {
    let m = 1;
    for (const r of rows) {
      m = Math.max(m, r.weightedBuy);
      if (r.current != null && Number.isFinite(r.current)) m = Math.max(m, r.current);
    }
    return Math.ceil(m * 1.08 / 50) * 50;
  }, [rows]);

  const tickers = positions.map((p) => p.ticker);

  const fmtTip = (v: number) => (currency === "USD" ? fmtUsd(v, 2) : fmtSgd(v, 2));

  return (
    <div
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--stroke)",
        background: "rgba(255,255,255,0.02)",
        padding: "1rem 1rem 0.5rem",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 650,
            margin: 0,
            color: "var(--text)",
          }}
        >
          Weighted avg buy vs current price
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onSelectAll}
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid var(--stroke)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClearAll}
            style={{
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid var(--stroke)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Clear all
          </button>
        </div>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 12px", lineHeight: 1.45 }}>
        Toggle tickers to compare average cost with the latest quote. In SGD mode, values use <strong>today’s</strong> USD/SGD
        spot (same basis as the rest of the portfolio view).
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {tickers.map((t) => {
          const on = chartOn[t] === true;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggleTicker(t)}
              className="mono"
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid " + (on ? "rgba(96,165,250,0.5)" : "var(--stroke)"),
                background: on ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.03)",
                color: on ? "var(--text)" : "var(--muted)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: "2rem 0", textAlign: "center" }}>
          Select at least one holding to plot the chart.
        </div>
      ) : (
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 28, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
              <XAxis dataKey="ticker" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--stroke)" }} />
              <YAxis
                domain={[0, maxY]}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={{ stroke: "var(--stroke)" }}
                tickFormatter={(v) => v.toFixed(0)}
                label={{
                  value: currency === "USD" ? "USD" : "SGD",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--muted)",
                  fontSize: 11,
                }}
              />
              <Tooltip
                formatter={(v: number, name: string) => [fmtTip(v), name]}
                labelFormatter={(l) => String(l)}
                contentStyle={{
                  background: "var(--bg1)",
                  border: "1px solid var(--stroke)",
                  borderRadius: 12,
                  color: "var(--text)",
                }}
              />
              <Legend
                wrapperStyle={{ paddingTop: 8 }}
                formatter={(value) => <span style={{ color: "var(--muted)", fontSize: 13 }}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="weightedBuy"
                name="Weighted buy price"
                stroke={BLUE}
                strokeWidth={2.5}
                dot={{ r: 4, fill: BLUE, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              >
                <LabelList dataKey="weightedBuy" content={PriceLabel} />
              </Line>
              <Line
                type="monotone"
                dataKey="current"
                name="Current price"
                stroke={RED}
                strokeWidth={2.5}
                dot={{ r: 4, fill: RED, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              >
                <LabelList dataKey="current" content={PriceLabel} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
