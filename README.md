# fraud-scoring

A horizontally-scalable fraud-scoring backend. Scores payment transactions against
sliding-window rules in real time (~500 TPS target), deduplicates by `transactionId`,
and persists every transaction durably for listing.

- **API:** NestJS + TypeScript (`apps/api`)
- **Scoring truth:** Redis (atomic single-key Lua sliding-window aggregates)
- **Durable store:** PostgreSQL (insert-only, serves listing)
- **Shared contract:** `@fraud/shared` DTO types (`packages/shared`)

## Endpoints

### `POST /score`

Scores one transaction, deduplicates, persists, returns a decision.

Request:
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

Response:
```json
{
  "decision": "approve|review|decline",
  "score": 0,
  "triggeredRules": ["velocity_card_1m", "new_geo"],
  "evaluatedAt": "ISO-8601"
}
```

Score map: `decline=0`, `review=50`, `approve=100`. Worst triggered rule wins.

### `GET /transactions`

Keyset (cursor) pagination, newest first.

```
GET /transactions?limit=50&cursor=<id>
-> { "items": [ ... ], "nextCursor": <id> | null }
```

## Rules

| Rule | Trigger | Decision |
|------|---------|----------|
| `velocity_card_1m` | > 5 transactions on one card in the last 60s | decline |
| `shared_device` | one `deviceFingerprint` used by > 3 distinct customers in 24h | decline |
| `amount_spike` | amount > 10× median for the customer over 24h (needs ≥ 2 prior txns) | review |
| `new_geo` | country never seen for the customer **and** amount > 500 | review |

## Design highlights

- **Redis is the source of truth for scoring.** Each rule is a single Redis key updated
  by an atomic Lua script (`ZADD` + `ZREMRANGEBYSCORE` evict + `ZCARD`). Single-key →
  Redis Cluster shards cleanly. Postgres is updated synchronously and only read for listing.
- **Idempotent by design.** Every Redis structure uses a deduplicating member
  (`transactionId` or `customerId`) and uses `payload.createdAt` as the sort score, so
  re-processing the same transaction is a byte-identical no-op. Safe to retry; never double-counts.
- **Durability before response.** The Postgres insert (`ON CONFLICT (transaction_id) DO NOTHING`)
  completes before `200` is returned — a transaction is durable before the client hears "ok".
- **Fail closed.** If Redis is unavailable the API returns `503` rather than silently approving.
- **new_geo self-heals.** The "forever" geo set rebuilds from Postgres
  (`SELECT DISTINCT country …`) on a cold Redis miss.

## Monorepo layout (npm workspaces)

```
fraud-scoring/
  packages/shared/   # ScoreRequest / ScoreResponse / Decision — shared by API and frontend
  apps/api/          # NestJS backend
  apps/web/          # frontend (separate workstream)
```

## Getting started

Requirements: Node 20+, Docker (for tests), and a running Postgres + Redis for local serving.

```bash
# install all workspaces (from repo root)
npm install

# local Postgres + Redis
cd apps/api && docker compose up -d

# run the API
npm run start:dev          # http://localhost:3000
```

Environment (`apps/api`, defaults shown):
```
PG_URL=postgres://fraud:fraud@localhost:5432/fraud
REDIS_URL=redis://localhost:6379
```

## Testing

Integration and e2e tests use [Testcontainers](https://testcontainers.com/) — a single
Postgres + Redis pair is booted once for the whole suite (`apps/api/test/global-setup.ts`).
Docker must be running.

```bash
cd apps/api
npm test                   # full suite (unit + integration + e2e)
```

## Load testing (500 TPS)

Manual — requires the stack up, the API running, and the [k6](https://k6.io/) binary:

```bash
cd apps/api
k6 run k6/score-load.js     # ramps to 500 TPS, holds 5 min
```

Thresholds: error rate < 0.1%, p99 < 50ms. Verify zero data loss with
`SELECT count(DISTINCT transaction_id) FROM transactions;`.

## Docs

- Design spec: `docs/superpowers/specs/2026-06-01-fraud-scoring-backend-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-01-fraud-scoring-backend.md`
