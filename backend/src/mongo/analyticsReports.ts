import type { Db } from "mongodb";
import type {
  AnalyticsReportDetail,
  AnalyticsReportKind,
  AnalyticsReportSummary,
} from "../analyticsReports.js";
import { toIsoString } from "./converters.js";
import { resolveUserObjectId } from "./transactions.js";
import type { AnalyticsReportDoc } from "./types.js";

const MAX_PER_KIND = 30;

function toSummary(doc: AnalyticsReportDoc): AnalyticsReportSummary {
  return {
    id: doc.legacy_id,
    kind: doc.kind,
    createdAt: toIsoString(doc.created_at),
    preview: doc.body.trim().slice(0, 160).replace(/\s+/g, " "),
  };
}

function toDetail(doc: AnalyticsReportDoc): AnalyticsReportDetail {
  return { ...toSummary(doc), body: doc.body };
}

export async function saveAnalyticsReport(
  db: Db,
  legacyUserId: string,
  kind: AnalyticsReportKind,
  body: string,
  legacyId: string
): Promise<void> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  await db.collection("analytics_reports").insertOne({
    legacy_id: legacyId,
    user_id: userOid,
    kind,
    body,
    created_at: new Date(),
  });

  const count = await db.collection("analytics_reports").countDocuments({ user_id: userOid, kind });
  const extra = count - MAX_PER_KIND;
  if (extra > 0) {
    const oldest = await db
      .collection<AnalyticsReportDoc>("analytics_reports")
      .find({ user_id: userOid, kind })
      .sort({ created_at: 1 })
      .limit(extra)
      .project({ legacy_id: 1 })
      .toArray();
    await db.collection("analytics_reports").deleteMany({
      legacy_id: { $in: oldest.map((r) => r.legacy_id) },
    });
  }
}

export async function listAnalyticsReports(
  db: Db,
  legacyUserId: string,
  opts?: { kind?: AnalyticsReportKind; limit?: number }
): Promise<AnalyticsReportSummary[]> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const limit = Math.min(opts?.limit ?? 50, 100);
  const filter: { user_id: typeof userOid; kind?: AnalyticsReportKind } = { user_id: userOid };
  if (opts?.kind) filter.kind = opts.kind;
  const docs = await db
    .collection<AnalyticsReportDoc>("analytics_reports")
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toSummary);
}

export async function getAnalyticsReport(
  db: Db,
  legacyUserId: string,
  legacyId: string
): Promise<AnalyticsReportDetail | null> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const doc = await db.collection<AnalyticsReportDoc>("analytics_reports").findOne({
    user_id: userOid,
    legacy_id: legacyId,
  });
  return doc ? toDetail(doc) : null;
}

export async function getPreviousAnalyticsReport(
  db: Db,
  legacyUserId: string,
  kind: AnalyticsReportKind,
  beforeCreatedAt: string
): Promise<AnalyticsReportDetail | null> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const before = new Date(beforeCreatedAt);
  const doc = await db
    .collection<AnalyticsReportDoc>("analytics_reports")
    .find({ user_id: userOid, kind, created_at: { $lt: before } })
    .sort({ created_at: -1 })
    .limit(1)
    .next();
  return doc ? toDetail(doc) : null;
}

export async function deleteAnalyticsReport(
  db: Db,
  legacyUserId: string,
  legacyId: string
): Promise<boolean> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const result = await db.collection("analytics_reports").deleteOne({
    user_id: userOid,
    legacy_id: legacyId,
  });
  return result.deletedCount > 0;
}
