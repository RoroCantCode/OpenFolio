import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalyticsReportDetail, AnalyticsReportKind, AnalyticsReportSummary } from "../api";
import {
  deleteAnalyticsReport,
  fetchAnalyticsModelPolicy,
  fetchAnalyticsReport,
  fetchAnalyticsReports,
  postAnalyzePortfolio,
  postInvestmentIdeas,
} from "../api";

type LoadingKind = "analyze" | "ideas";

const STALE_DAYS = 30;

const markdownComponents: Partial<Components> = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

class MarkdownSafeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Advanced analytics markdown render failed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function ResultBlock({ title, body }: { title: string; body: string }) {
  const fallback = (
    <div
      className="analytics-md-fallback"
      style={{
        color: "var(--text)",
        fontSize: 14,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {body}
    </div>
  );

  return (
    <div
      className="panel"
      style={{
        marginTop: 20,
        padding: "1rem 1.25rem",
      }}
    >
      <h2 className="section-title" style={{ margin: "0 0 12px" }}>
        {title}
      </h2>
      <MarkdownSafeBoundary key={`${title}:${body.length}:${body.slice(0, 120)}`} fallback={fallback}>
        <div className="analytics-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {body}
          </ReactMarkdown>
        </div>
      </MarkdownSafeBoundary>
    </div>
  );
}

function kindLabel(kind: AnalyticsReportKind): string {
  return kind === "portfolio_analysis" ? "Portfolio analysis" : "Investment ideas";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function AdvancedAnalyticsPage() {
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<string | null>(null);
  const [investmentIdeas, setInvestmentIdeas] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modelPolicy, setModelPolicy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [reports, setReports] = useState<AnalyticsReportSummary[]>([]);
  const [reportsErr, setReportsErr] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [comparePrevious, setComparePrevious] = useState<AnalyticsReportDetail | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const analyticsPdfRef = useRef<HTMLDivElement>(null);

  const reloadReports = useCallback(async () => {
    setReportsErr(null);
    try {
      setReports(await fetchAnalyticsReports());
    } catch (e) {
      setReportsErr(e instanceof Error ? e.message : "Could not load saved reports.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAnalyticsModelPolicy()
      .then((p) => {
        if (!cancelled) setModelPolicy(p);
      })
      .catch(() => {
        if (!cancelled) setModelPolicy(null);
      });
    void reloadReports();
    return () => {
      cancelled = true;
    };
  }, [reloadReports]);

  const staleReminder = useMemo(() => {
    const latestAnalysis = reports.find((r) => r.kind === "portfolio_analysis");
    if (!latestAnalysis) {
      return "You have not saved a portfolio analysis yet. Run Analyze portfolio to create your first report.";
    }
    const days = daysSince(latestAnalysis.createdAt);
    if (days >= STALE_DAYS) {
      return `Your last portfolio analysis was ${days} days ago (${formatWhen(latestAnalysis.createdAt)}). Consider refreshing your review.`;
    }
    return null;
  }, [reports]);

  const busy = loading !== null;

  const applyReportToView = (report: AnalyticsReportDetail, previous: AnalyticsReportDetail | null) => {
    setActiveReportId(report.id);
    setComparePrevious(previous);
    setShowCompare(false);
    if (report.kind === "portfolio_analysis") {
      setPortfolioAnalysis(report.body);
    } else {
      setInvestmentIdeas(report.body);
    }
  };

  const openSavedReport = useCallback(async (id: string) => {
    setErr(null);
    try {
      const { report, previous } = await fetchAnalyticsReport(id);
      applyReportToView(report, previous);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open report.");
    }
  }, []);

  const runAnalyze = useCallback(async () => {
    setErr(null);
    setLoading("analyze");
    try {
      const { analysis, reportId } = await postAnalyzePortfolio();
      setPortfolioAnalysis(analysis);
      setActiveReportId(reportId);
      setComparePrevious(null);
      setShowCompare(false);
      await reloadReports();
      const { previous } = await fetchAnalyticsReport(reportId);
      setComparePrevious(previous);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(null);
    }
  }, [reloadReports]);

  const runIdeas = useCallback(async () => {
    setErr(null);
    setLoading("ideas");
    try {
      const { ideas, reportId } = await postInvestmentIdeas();
      setInvestmentIdeas(ideas);
      setActiveReportId(reportId);
      setComparePrevious(null);
      setShowCompare(false);
      await reloadReports();
      const { previous } = await fetchAnalyticsReport(reportId);
      setComparePrevious(previous);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load investment ideas.");
    } finally {
      setLoading(null);
    }
  }, [reloadReports]);

  const clearView = useCallback(() => {
    if (busy) return;
    setPortfolioAnalysis(null);
    setInvestmentIdeas(null);
    setActiveReportId(null);
    setComparePrevious(null);
    setShowCompare(false);
    setErr(null);
  }, [busy]);

  const removeReport = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this saved report?")) return;
      try {
        await deleteAnalyticsReport(id);
        if (activeReportId === id) clearView();
        await reloadReports();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Delete failed.");
      }
    },
    [activeReportId, clearView, reloadReports]
  );

  const downloadAnalyticsPdf = useCallback(async () => {
    const el = analyticsPdfRef.current;
    const hasP = Boolean(portfolioAnalysis?.trim());
    const hasI = Boolean(investmentIdeas?.trim());
    if (!el || (!hasP && !hasI)) return;
    const filename =
      hasP && hasI ? "openfolio-analytics.pdf" : hasP ? "openfolio-portfolio-analysis.pdf" : "openfolio-investment-ideas.pdf";
    setPdfBusy(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const injectPdfStyles = (clonedDoc: Document) => {
        const root = clonedDoc.querySelector('[data-pdf-capture="analytics-export"]');
        if (!root) return;
        const style = clonedDoc.createElement("style");
        style.textContent = `
          [data-pdf-capture="analytics-export"],
          [data-pdf-capture="analytics-export"] * {
            color: #111111 !important;
            border-color: #d1d5db !important;
            box-shadow: none !important;
          }
          [data-pdf-capture="analytics-export"] {
            background: #ffffff !important;
          }
          [data-pdf-capture="analytics-export"] .section-title {
            color: #374151 !important;
          }
          [data-pdf-capture="analytics-export"] a,
          [data-pdf-capture="analytics-export"] a * {
            color: #0b57d0 !important;
          }
          [data-pdf-capture="analytics-export"] .analytics-md h3 {
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] pre,
          [data-pdf-capture="analytics-export"] code {
            background: #f3f4f6 !important;
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] th {
            background: #f9fafb !important;
            color: #374151 !important;
          }
          [data-pdf-capture="analytics-export"] td {
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] blockquote {
            color: #374151 !important;
          }
        `;
        clonedDoc.head.appendChild(style);
      };
      await html2pdf()
        .set({
          margin: [14, 14, 14, 14],
          filename,
          image: { type: "jpeg", quality: 0.92 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
            onclone: (clonedDoc: Document) => {
              injectPdfStyles(clonedDoc);
            },
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(el)
        .save();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not create PDF.");
    } finally {
      setPdfBusy(false);
    }
  }, [portfolioAnalysis, investmentIdeas]);

  const hasPortfolioText = Boolean(portfolioAnalysis?.trim());
  const hasInvestmentIdeasText = Boolean(investmentIdeas?.trim());
  const hasPdfContent = hasPortfolioText || hasInvestmentIdeasText;

  return (
    <section>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 10, lineHeight: 1.5, maxWidth: 720 }}>
        Server-side Google Gemini reads your OpenFolio snapshot (same data as Home / Breakdown / Ledger). Not
        financial advice. Requires <span className="mono">GEMINI_API_KEY</span>.
        {modelPolicy ? (
          <>
            {" "}
            <span className="mono" style={{ color: "var(--text)" }}>
              {modelPolicy}
            </span>
          </>
        ) : null}
      </p>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 16, lineHeight: 1.5, fontSize: 13, maxWidth: 720 }}>
        <strong style={{ color: "var(--text)" }}>Analyze portfolio</strong> reviews your trades and positioning in
        plain language. <strong style={{ color: "var(--text)" }}>Investment Ideas</strong> sends a structured snapshot of your book and
        equity-only trade patterns to Gemini (FX/currency instruments excluded), then surfaces adjacent quality and
        growth names you do not already hold. Each run is saved automatically (up to 30 per type).
      </p>

      {staleReminder && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(251,191,36,0.35)",
            background: "rgba(251,191,36,0.1)",
            color: "var(--text)",
            fontSize: 13,
            lineHeight: 1.5,
            maxWidth: 720,
          }}
        >
          {staleReminder}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void runAnalyze()}>
          {loading === "analyze" ? "Analyzing…" : "Analyze portfolio"}
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void runIdeas()}>
          {loading === "ideas" ? "Generating…" : "Investment Ideas"}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={clearView}>
          Clear view
        </button>
      </div>

      <div className="panel" style={{ marginTop: 20, padding: "1rem 1.25rem" }}>
        <h2 className="section-title" style={{ margin: "0 0 10px" }}>
          Saved reports
        </h2>
        {reportsErr && (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>{reportsErr}</p>
        )}
        {!reportsErr && reports.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No saved reports yet.</p>
        )}
        {reports.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {reports.map((r) => (
              <li
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid " + (activeReportId === r.id ? "rgba(94,234,212,0.45)" : "var(--stroke)"),
                  background: activeReportId === r.id ? "rgba(94,234,212,0.08)" : "rgba(255,255,255,0.02)",
                }}
              >
                <button
                  type="button"
                  onClick={() => void openSavedReport(r.id)}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{kindLabel(r.kind)}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{formatWhen(r.createdAt)}</div>
                  <div
                    style={{
                      color: "var(--muted)",
                      fontSize: 12,
                      marginTop: 6,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.preview}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 8px", fontSize: 12, flexShrink: 0 }}
                  onClick={() => void removeReport(r.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(251,113,133,0.12)",
            border: "1px solid rgba(251,113,133,0.35)",
            color: "#fecdd3",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {err}
        </div>
      )}

      <div style={{ marginTop: 8, paddingBottom: 32 }}>
        {hasPdfContent && (
          <>
            <div ref={analyticsPdfRef} data-pdf-capture="analytics-export">
              {hasPortfolioText && portfolioAnalysis && (
                <ResultBlock title="Portfolio analysis" body={portfolioAnalysis} />
              )}
              {hasInvestmentIdeasText && investmentIdeas && (
                <ResultBlock title="Investment ideas" body={investmentIdeas} />
              )}
            </div>
            {comparePrevious && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "8px 12px", fontSize: 13 }}
                  onClick={() => setShowCompare((v) => !v)}
                >
                  {showCompare ? "Hide" : "Compare with"} previous ({formatWhen(comparePrevious.createdAt)})
                </button>
                {showCompare && (
                  <ResultBlock
                    title={`Previous ${kindLabel(comparePrevious.kind).toLowerCase()}`}
                    body={comparePrevious.body}
                  />
                )}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 10 }}>
              <button
                type="button"
                className="btn-ghost"
                disabled={pdfBusy}
                style={{ padding: "8px 12px", fontSize: 13 }}
                onClick={() => void downloadAnalyticsPdf()}
              >
                {pdfBusy ? "Preparing PDF…" : "Download PDF"}
              </button>
            </div>
          </>
        )}
        {!hasPdfContent && !busy && !err && (
          <p style={{ color: "var(--muted)", marginTop: 24 }}>
            Choose an action above or open a saved report from history.
          </p>
        )}
      </div>
    </section>
  );
}
