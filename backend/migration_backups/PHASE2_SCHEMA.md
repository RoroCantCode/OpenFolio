# Phase 2 — MongoDB Target Schema

**URI:** `OPENFOLIO_MONGO_URI` (default `mongodb://localhost:27017`)  
**Database:** `OPENFOLIO_MONGO_DB` (default `openfolio`)

## Design principles

- Four collections mirror the four user-data SQLite tables (`_openfolio_migrations` excluded).
- Child documents reference `users._id` (`ObjectId`). External API/session IDs remain the SQLite **TEXT** primary keys via `legacy_id`.
- Monetary fields stored as **Decimal128**; dates as **BSON Date**; API boundary converts back to `number` / ISO **string**.
- **Idempotency:** migration upserts on `legacy_id` (watchlist upserts on `{ user_id, ticker }`). Re-runs update in place without duplicating.

---

## `users`

| Field | BSON type | Notes |
|-------|-----------|-------|
| `_id` | ObjectId | Mongo primary key |
| `legacy_id` | string | SQLite `users.id` (nanoid); returned as `id` to API |
| `email` | string | Lowercased; UNIQUE |
| `password_hash` | string | bcrypt |
| `display_name` | string | Default `""` |
| `theme` | string | `"dark"` \| `"light"` |
| `created_at` | Date | |

**Indexes**
- `{ legacy_id: 1 }` — **unique**
- `{ email: 1 }` — **unique** (case handled by normalizing to lowercase on write)

---

## `transactions`

| Field | BSON type | Notes |
|-------|-----------|-------|
| `_id` | ObjectId | Internal |
| `legacy_id` | string | SQLite `transactions.id`; API `id` |
| `user_id` | ObjectId | → `users._id` |
| `occurred_at` | Date | API `occurred_at` ISO string |
| `side` | string | `buy` \| `sell` |
| `ticker` | string | Uppercase |
| `name` | string \| null | |
| `quantity` | Decimal128 | |
| `price_usd` | Decimal128 | |
| `fx_sgd_per_usd` | Decimal128 | |
| `funding_source` | string | `dbs` \| `bonus` \| `proceeds` \| `unspecified` |
| `fees_usd` | Decimal128 | |
| `notes` | string \| null | |

**Indexes**
- `{ legacy_id: 1 }` — **unique**
- `{ user_id: 1 }`
- `{ user_id: 1, occurred_at: 1, legacy_id: 1 }` — list ordering
- `{ ticker: 1 }`

---

## `watchlist`

| Field | BSON type | Notes |
|-------|-----------|-------|
| `_id` | ObjectId | Internal (no SQLite surrogate id) |
| `user_id` | ObjectId | → `users._id` |
| `ticker` | string | Uppercase |
| `sort_order` | int | |

**Indexes**
- `{ user_id: 1, ticker: 1 }` — **unique**
- `{ user_id: 1, sort_order: 1 }`

---

## `analytics_reports`

| Field | BSON type | Notes |
|-------|-----------|-------|
| `_id` | ObjectId | Internal |
| `legacy_id` | string | SQLite `id`; API `id` |
| `user_id` | ObjectId | → `users._id` |
| `kind` | string | `portfolio_analysis` \| `investment_ideas` |
| `body` | string | |
| `created_at` | Date | API ISO string |

**Indexes**
- `{ legacy_id: 1 }` — **unique**
- `{ user_id: 1, kind: 1, created_at: -1 }`

---

## Idempotency strategy

| Collection | Second-run behavior |
|------------|---------------------|
| `users` | `replaceOne({ legacy_id }, doc, { upsert: true })` |
| `transactions` | `replaceOne({ legacy_id }, doc, { upsert: true })` |
| `watchlist` | `replaceOne({ user_id, ticker }, doc, { upsert: true })` |
| `analytics_reports` | `replaceOne({ legacy_id }, doc, { upsert: true })` |

No collection drops unless `--drop` flag is passed explicitly.
