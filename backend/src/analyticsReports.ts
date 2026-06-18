export type AnalyticsReportKind = "portfolio_analysis" | "investment_ideas";

export type AnalyticsReportSummary = {
  id: string;
  kind: AnalyticsReportKind;
  createdAt: string;
  preview: string;
};

export type AnalyticsReportDetail = AnalyticsReportSummary & {
  body: string;
};
