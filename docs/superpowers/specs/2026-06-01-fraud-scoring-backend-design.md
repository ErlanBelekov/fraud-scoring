# Fraud Scoring Backend — Design

**Date:** 2026-06-01
**Stack:** NestJS + TypeScript + PostgreSQL + Redis
**Targets:** horizontally scalable, ~500 TPS on `/score`, fraud rules with Redis as scoring source of truth.

---

## 1. Overview

Two HTTP endpoints:

1. `POST /score` — accept a transaction JSON, deduplicate by `transactionId`, score it
   against 4 fraud rules, persist it durably, return a decision.
2. `GET /transactions` — list recent transactions with keyset (cursor) pagination.

**Core architectural decisions:**

- **Redis = source of truth for scoring.** Sliding-window aggregates live in Redis
  (sorted sets / set). Volatile aggregates are acceptable; the one "forever" rule (geo)
  self-heals by rebuilding from Postgres on a cold miss.
- **Postgres = durable read store.** Insert-only (no updates). Serves `/transactions`.
- **No Kafka.** At 500 TPS a synchronous, idempotent Postgres insert is simpler, durable,
  and fast enough (Postgres handles 10k+ simple inserts/s). Kafka/batching dropped as
  over-engineering for this scale.
- **Idempotency by design.** Every Redis structure uses a *deduplicating member*
  (txId or entity id) and uses `payload.createdAt` as the score — so re-processing the
  same transaction is a byte-identical no-op. Safe to retry, never double-counts.
- **Fail closed.** Fraud scoring rejects (503) when Redis is unavailable. Never silent-approve.

---

## 2. Components

| Component | Role |
|-----------|------|
| **NestJS API** | Stateless. N pods behind a load balancer. Validate → dedup → score → persist. |
| **Redis** (cluster-ready) | Scoring truth: sliding-window ZSETs, geo SET, dedup keys. |
| **PostgreSQL** | Durable, insert-only store for listing. Unique constraint = dedup backstop. |

Horizontal scale: API pods are stateless; all shared state is in Redis and Postgres.
Each rule touches a single Redis key, so Lua scripts are single-key → Redis Cluster shards cleanly.

---

## 3. `/score` flow

```
1. Validate DTO (class-validator).
2. Dedup claim: SET NX idem:{txId} = "pending", TTL 24h.
     - key exists WITH decision  -> return stored decision (idempotent replay, 200).
     - key exists, still "pending" -> rare in-flight race; short retry then 409.
3. Score: run 4 rule Lua scripts (each single-key, atomic).
4. Compute decision + score (worst rule wins).
5. INSERT into Postgres, ON CONFLICT (transaction_id) DO NOTHING.   <-- durability point
6. SET idem:{txId} = decision JSON (overwrite "pending"), TTL 24h.
7. Return 200 JSON.
```

The Postgres insert completes **before** returning 200 → the transaction is durable before
the client hears "ok" (never-lose guarantee).

**Concurrency / locking:** no distributed lock (no Redlock).
- Per-rule Lua scripts are atomic (Redis is single-threaded; Lua runs uninterrupted).
- `SET NX idem:{txId}` is the only mutual-exclusion needed; concurrent duplicates: one
  wins the claim, others observe the existing key.

**Retry safety:** because members deduplicate and the score is `payload.createdAt`,
re-running steps 3–5 for the same transaction produces identical Redis state and an
idempotent insert. No "skip operations" logic required.

### Input
```json
{
  "transactionId": "uuid",
  "cardToken": "string",
  "customerId": "string",
  "amount": 123.45,
  "currency": "USD",
  "ip": "1.2.3.4",
  "country": "US",
  "deviceFingerprint": "string",
  "createdAt": "ISO-8601"
}
```

### Output
```json
{
  "decision": "approve|review|decline",
  "score": 0-100,
  "triggeredRules": ["velocity_card_1m", "new_geo"],
  "evaluatedAt": "ISO-8601"
}
```

---

## 4. Rules & Redis structures

All sorted-set scores = `payload.createdAt` in ms (deterministic; never `now()`),
except the amount ZSET whose score is the amount value.

| Rule | Key | Type | Member | Score | TTL | Trigger |
|------|-----|------|--------|-------|-----|---------|
| velocity | `card:{cardToken}` | ZSET | txId | createdAt(ms) | 5m | count in last 60s `> 5` → **decline** |
| shared device | `dev:{fgrpt}` | ZSET | customerId | createdAt(ms) | 24h | distinct customers in 24h `> 3` → **decline** |
| amount spike | `amt:{customerId}` | ZSET | txId | amount | 24h | `amount > 10 × median(24h)` → **review** |
| new geo | `geo:{customerId}` | SET | country | — | none | new country **AND** `amount > 500` → **review** |
| idempotency | `idem:{txId}` | STRING | — | decision json | 24h | dedup / replay |

**Rule logic (Lua, one script per rule, single-key, atomic):**

- **velocity** — `ZADD`; `ZREMRANGEBYSCORE 0 (createdAt-60000)`; `ZCARD`. `> 5` → decline.
  Member=txId → replay is a no-op (count unchanged).
- **shared device** — `ZADD`; evict `< createdAt-86400000`; `ZCARD`. Member=customerId →
  `ZCARD` = distinct customers; replay updates ts only, count unchanged. `> 3` → decline.
- **amount spike** — needs two axes (time window + value rank). Store
  `amt:{customerId}` with the txId and a `ts:amount` payload; evict by ts in Lua; return the
  surviving amounts; compute median in app (sort, middle element). Most customers are low
  volume → cheap. Trigger `amount > 10 × median`. (Median ill-defined for the first txn /
  tiny samples → rule does not trigger below a small minimum sample, e.g. < 2 prior txns.)
- **new geo** — `SISMEMBER geo:{customerId} country`. On cold miss (key absent) rebuild from
  Postgres: `SELECT DISTINCT country FROM transactions WHERE customer_id = :id`, repopulate the
  SET, then check. `SADD` the new country. Trigger when country is new **and** `amount > 500`.

**Decision merge (worst rule wins):**
```
if any rule => decline:  decision = decline,  score = 0
elif any rule => review:  decision = review,   score = 50
else:                     decision = approve,  score = 100
triggeredRules = [all rules that fired]
evaluatedAt = now() (response timestamp)
```

Rule name strings (for `triggeredRules`): `velocity_card_1m`, `shared_device`,
`amount_spike`, `new_geo`.

---

## 5. Postgres schema

```sql
CREATE TABLE transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- cursor + PK
  transaction_id  UUID        NOT NULL,
  card_token      TEXT        NOT NULL,
  customer_id     TEXT        NOT NULL,
  amount          NUMERIC(18,2) NOT NULL,
  currency        CHAR(3)     NOT NULL,
  ip              INET,
  country         TEXT        NOT NULL,
  device_fingerprint TEXT,
  created_at      TIMESTAMPTZ NOT NULL,              -- from payload (scoring time)
  decision        TEXT        NOT NULL,
  score           SMALLINT    NOT NULL,
  triggered_rules TEXT[]      NOT NULL DEFAULT '{}',
  evaluated_at    TIMESTAMPTZ NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transaction_id UNIQUE (transaction_id)
);
CREATE INDEX idx_tx_id_desc ON transactions (id DESC);
```

- `id` (BIGINT identity) = primary key **and** pagination cursor. Strictly monotonic →
  stable keyset pagination; 8 bytes, good index locality, no random page splits.
- `transaction_id` (UUID) = client business key. `uq_transaction_id` backs
  `ON CONFLICT (transaction_id) DO NOTHING` and is the durable dedup safety net.
- DTO validation (class-validator) handles value-shape checks; redundant CHECK constraints
  intentionally omitted.
- `created_at` from payload; `inserted_at` = ingest time.

**Why BIGINT not UUID for `id`:** cursor pagination requires monotonic ordering. UUIDv4 is
random → unusable as a cursor. BIGINT identity is strictly increasing → ideal cursor,
smaller, faster inserts. (UUIDv7 would work but is unnecessary at single-DB / 500 TPS.)

---

## 6. `GET /transactions` — keyset cursor pagination

```
Query:  ?limit=N (default 50, max 100)  &cursor=<id>  (optional)

SQL:    SELECT ... FROM transactions
        WHERE id < :cursor        -- clause omitted on first page
        ORDER BY id DESC
        LIMIT :limit + 1          -- +1 row to detect a next page

Resp:   { "items": [ ... ], "nextCursor": "<id of last item>" | null }
```

- Fetch `limit+1`; return `limit`; the extra row sets `nextCursor` (null when absent).
- No `COUNT`, no `OFFSET` → O(limit) regardless of depth.
- Cursor validated as a positive integer.

---

## 7. Error handling & degradation

Fraud scoring **fails closed** — never silent-approve.

| Failure | Behavior |
|---------|----------|
| Bad DTO | `400`, class-validator messages |
| Redis unavailable | `503` (scoring truth gone — cannot decide safely) |
| Geo cold-miss + PG rebuild fails | degrade: geo rule treated as not-triggered, other 3 rules score, log warn |
| PG insert fails after decision | retry once; if still failing → `503` (durability promised; decision withheld) |
| Duplicate `transactionId` | idempotent replay, return stored decision (`200`) |

---

## 8. Load testing (500 TPS target)

- Tool: **k6** (alt: autocannon). Ramp 0 → 500 TPS, hold 5 min.
- Mixed payload: ~70% unique txId, ~20% duplicate (exercise idempotent replay),
  ~10% same-card burst (trigger velocity decline).
- Assertions: p99 < ~50ms, error rate < 0.1%, **zero lost rows** (DB count == unique sent).
- Observe: Redis ops/s, PG insert latency, Node event-loop lag.
- Separate read test: `/transactions` pagination under concurrent read load.

---

## 9. Out of scope (YAGNI)

- Configurable rule thresholds / score weights (fixed: decline=0, review=50, approve=100).
- Kafka, batching, read replicas (revisit only if TPS target rises materially).
- Auth/authz, rate limiting, multi-tenant — not requested.
