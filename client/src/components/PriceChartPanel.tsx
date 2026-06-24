import { useMemo, type CSSProperties } from "react";
import { fmtUsd } from "../format";

function sparkPath(values: number[], width: number, height: number, padLeft: number, padBottom: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padTop = 8;
  const innerW = width - padLeft - 8;
  const innerH = height - padTop - padBottom;

  return values
    .map((v, i) => {
      const x = padLeft + (i / (values.length - 1)) * innerW;
      const y = padTop + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatAxisDate(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Labeled price chart for watchlist detail popup. Y = USD close, X = time. */
export function PriceChartPanel({
  closes,
  timestamps,
  changePct,
  width = 720,
  height = 140,
  className,
  style,
}: {
  closes: number[];
  timestamps: number[];
  changePct: number | null;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const padLeft = 52;
  const padBottom = 22;

  const up = changePct != null && changePct > 0;
  const down = changePct != null && changePct < 0;
  const stroke = up ? "var(--ok)" : down ? "var(--danger)" : "var(--muted)";

  const { path, yMin, yMax, xStart, xEnd } = useMemo(() => {
    if (closes.length < 2) {
      return { path: "", yMin: 0, yMax: 0, xStart: "", xEnd: "" };
    }
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const t0 = timestamps[0] ?? timestamps[timestamps.length - 1] ?? 0;
    const t1 = timestamps[timestamps.length - 1] ?? t0;
    return {
      path: sparkPath(closes, width, height, padLeft, padBottom),
      yMin: min,
      yMax: max,
      xStart: formatAxisDate(t0),
      xEnd: formatAxisDate(t1),
    };
  }, [closes, timestamps, width, height]);

  if (!path) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} style={style}>
        <text x={padLeft} y={height / 2} fill="var(--muted)" fontSize={12}>
          No chart data
        </text>
      </svg>
    );
  }

  const padTop = 8;
  const innerH = height - padTop - padBottom;
  const yTop = padTop + 4;
  const yBottom = padTop + innerH;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      style={{ display: "block", maxWidth: "100%", ...style }}
    >
      <text x={4} y={yTop} fill="var(--muted)" fontSize={10} className="mono">
        {fmtUsd(yMax, 0)}
      </text>
      <text x={4} y={yBottom} fill="var(--muted)" fontSize={10} className="mono">
        {fmtUsd(yMin, 0)}
      </text>
      <text x={padLeft} y={height - 4} fill="var(--muted)" fontSize={10}>
        {xStart}
      </text>
      <text x={width - 8} y={height - 4} fill="var(--muted)" fontSize={10} textAnchor="end">
        {xEnd}
      </text>
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
