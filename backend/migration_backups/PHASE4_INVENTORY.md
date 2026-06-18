# Phase 4 — Data-layer change inventory

All SQLite `db.prepare(...)` calls replaced by `server/src/mongo/*` modules using the native `mongodb` driver.

| File | Operations migrated | New module |
|------|---------------------|------------|
| `server/src/db.ts` | Connection, indexes, seed owner/watchlist | `connectDb()`, `getDb()` (MongoDB) |
| `server/src/migrate.ts` | SQLite DDL migrations | Constants only (`SEED_OWNER_*`) |
| `server/src/auth.ts` | User SELECT/INSERT/UPDATE | `mongo/users.ts` |
| `server/src/index.ts` | Transaction CRUD, bulk delete, watchlist replace, portfolio read | `mongo/transactions.ts`, `mongo/watchlist.ts` |
| `server/src/analyticsReports.ts` | Types only | `mongo/analyticsReports.ts` |
| `server/src/analyticsBundle.ts` | Transaction SELECT | `mongo/transactions.ts` |
| `server/src/investmentIdeasPayload.ts` | Via `buildAnalyticsBundle` | unchanged signature (`Db`) |
| `server/src/watchlistPayload.ts` | Watchlist SELECT | `mongo/watchlist.ts` |
| `server/src/seed.ts` | Transaction INSERT/COUNT | `mongo/transactions.ts` |
| `server/src/importHistoricalTransactions.ts` | Transaction DELETE/INSERT/COUNT | `mongo/transactions.ts` |

**Unchanged above data layer:** `portfolio.ts`, `validate.ts`, `csvImport.ts`, `prices.ts`, `gemini.ts`, all client code.

**API boundary:** External `id` fields remain SQLite-era nanoid strings (`legacy_id`). Sessions store `legacy_id`. Decimal128 and BSON Date converted at mongo module boundary.
