import { ObjectId, type Db } from "mongodb";
import type { TransactionRow } from "../portfolio.js";
import { fromDecimal128, toDate, toDecimal128, toIsoString } from "./converters.js";
import type { TransactionDoc } from "./types.js";

export function transactionDocToRow(doc: TransactionDoc): TransactionRow {
  return {
    id: doc.legacy_id,
    occurred_at: toIsoString(doc.occurred_at),
    side: doc.side,
    ticker: doc.ticker,
    name: doc.name,
    quantity: fromDecimal128(doc.quantity),
    price_usd: fromDecimal128(doc.price_usd),
    fx_sgd_per_usd: fromDecimal128(doc.fx_sgd_per_usd),
    funding_source: doc.funding_source,
    fees_usd: fromDecimal128(doc.fees_usd),
    notes: doc.notes,
  };
}

export async function resolveUserObjectId(db: Db, legacyUserId: string): Promise<ObjectId> {
  const user = await db.collection("users").findOne(
    { legacy_id: legacyUserId },
    { projection: { _id: 1 } }
  );
  if (!user) throw new Error(`User not found for legacy_id: ${legacyUserId}`);
  return user._id;
}

export async function listUserTransactions(db: Db, legacyUserId: string): Promise<TransactionRow[]> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const docs = await db
    .collection<TransactionDoc>("transactions")
    .find({ user_id: userOid })
    .sort({ occurred_at: 1, legacy_id: 1 })
    .toArray();
  return docs.map(transactionDocToRow);
}

export async function getUserTransaction(
  db: Db,
  legacyUserId: string,
  legacyTxId: string
): Promise<TransactionRow | null> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const doc = await db.collection<TransactionDoc>("transactions").findOne({
    legacy_id: legacyTxId,
    user_id: userOid,
  });
  return doc ? transactionDocToRow(doc) : null;
}

export type InsertTransactionInput = {
  legacyUserId: string;
  legacyId: string;
  occurred_at: string;
  side: TransactionRow["side"];
  ticker: string;
  name: string | null;
  quantity: number;
  price_usd: number;
  fx_sgd_per_usd: number;
  funding_source: TransactionRow["funding_source"];
  fees_usd: number;
  notes: string | null;
};

export async function insertTransaction(db: Db, input: InsertTransactionInput): Promise<TransactionRow> {
  const userOid = await resolveUserObjectId(db, input.legacyUserId);
  const doc: Omit<TransactionDoc, "_id"> = {
    legacy_id: input.legacyId,
    user_id: userOid,
    occurred_at: toDate(input.occurred_at),
    side: input.side,
    ticker: input.ticker,
    name: input.name,
    quantity: toDecimal128(input.quantity),
    price_usd: toDecimal128(input.price_usd),
    fx_sgd_per_usd: toDecimal128(input.fx_sgd_per_usd),
    funding_source: input.funding_source,
    fees_usd: toDecimal128(input.fees_usd),
    notes: input.notes,
  };
  const { insertedId } = await db.collection("transactions").insertOne(doc);
  return transactionDocToRow({ _id: insertedId, ...doc });
}

export async function updateTransaction(
  db: Db,
  legacyUserId: string,
  legacyTxId: string,
  patch: Omit<InsertTransactionInput, "legacyUserId" | "legacyId">
): Promise<TransactionRow | null> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const $set = {
    occurred_at: toDate(patch.occurred_at),
    side: patch.side,
    ticker: patch.ticker,
    name: patch.name,
    quantity: toDecimal128(patch.quantity),
    price_usd: toDecimal128(patch.price_usd),
    fx_sgd_per_usd: toDecimal128(patch.fx_sgd_per_usd),
    funding_source: patch.funding_source,
    fees_usd: toDecimal128(patch.fees_usd),
    notes: patch.notes,
  };
  const result = await db.collection<TransactionDoc>("transactions").findOneAndUpdate(
    { legacy_id: legacyTxId, user_id: userOid },
    { $set },
    { returnDocument: "after" }
  );
  return result ? transactionDocToRow(result) : null;
}

export async function deleteTransaction(
  db: Db,
  legacyUserId: string,
  legacyTxId: string
): Promise<boolean> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const result = await db.collection("transactions").deleteOne({
    legacy_id: legacyTxId,
    user_id: userOid,
  });
  return result.deletedCount > 0;
}

export async function bulkDeleteTransactions(
  db: Db,
  legacyUserId: string,
  legacyTxIds: string[]
): Promise<number> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const result = await db.collection("transactions").deleteMany({
    user_id: userOid,
    legacy_id: { $in: legacyTxIds },
  });
  return result.deletedCount;
}

export async function countUserTransactions(db: Db, legacyUserId: string): Promise<number> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  return db.collection("transactions").countDocuments({ user_id: userOid });
}

export async function deleteAllUserTransactions(db: Db, legacyUserId: string): Promise<number> {
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const result = await db.collection("transactions").deleteMany({ user_id: userOid });
  return result.deletedCount;
}

export async function insertTransactionsBatch(
  db: Db,
  legacyUserId: string,
  rows: Omit<InsertTransactionInput, "legacyUserId">[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const userOid = await resolveUserObjectId(db, legacyUserId);
  const docs = rows.map((r) => ({
    legacy_id: r.legacyId,
    user_id: userOid,
    occurred_at: toDate(r.occurred_at),
    side: r.side,
    ticker: r.ticker,
    name: r.name,
    quantity: toDecimal128(r.quantity),
    price_usd: toDecimal128(r.price_usd),
    fx_sgd_per_usd: toDecimal128(r.fx_sgd_per_usd),
    funding_source: r.funding_source,
    fees_usd: toDecimal128(r.fees_usd),
    notes: r.notes,
  }));
  const result = await db.collection("transactions").insertMany(docs);
  return result.insertedCount;
}
