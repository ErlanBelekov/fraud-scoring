# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A fraud-scoring backend. `POST /score` evaluates a transaction against four
sliding-window rules and returns approve/review/decline; `GET /transactions` lists
stored transactions with cursor pagination. npm-workspaces monorepo.

```
packages/shared/   @fraud/shared — DTO contract (ScoreRequest, ScoreResponse, Decision). Framework-free.
apps/api/          NestJS backend (all the logic below)
apps/web/          frontend (separate workstream — do not assume it exists)
```

## Commands

Run `npm install` once from the repo root (workspaces hoist `@fraud/shared`).
Everything else runs from `apps/api/`:

```bash
cd apps/api
npx tsc --noEmit                 # type-check
npm test                         # full suite (needs Docker)
npm test -- path/to/file.spec.ts # single suite
npm run start:dev                # local server (needs Postgres + Redis up)
docker compose up -d             # local Postgres + Redis
```

## Architecture (read before changing scoring)

- **Redis is the source of truth for scoring.** Postgres is insert-only and only read by
  the listing endpoint and the new_geo cold-miss rebuild.
- **Each rule = one Redis key = one atomic Lua script** (`apps/api/src/infra/redis.provider.ts`
  defines `slidingCount` and `slidingMembers`). Keep rules single-key so Redis Cluster shards
  cleanly. Don't introduce multi-key Lua.
- **Idempotency is structural, not added on.** Every Redis member deduplicates
  (`transactionId` for velocity/amount, `customerId` for device) and the sort score is
  **`payload.createdAt`, never `Date.now()`**. This makes re-processing a no-op. If you change
  a member or use wall-clock time as a score, you break replay-safety.
- **Durability point:** `score.service.ts` inserts into Postgres (`ON CONFLICT DO NOTHING`)
  **before** returning. Don't move the insert after the response.
- **Fail closed:** Redis errors surface as `RedisUnavailableError` → `503`. Never default to approve.

### Request flow (`score.service.ts`)
`claim idem (SET NX)` → if duplicate, replay stored outcome → run 4 rules → merge (worst
severity wins) → insert Postgres → mark idem complete → return.

### Files
```
src/transactions/
  transaction.types.ts            Decision (re-exported from @fraud/shared), ScoringContext, RuleResult
  dto/                            ScoreRequestDto (implements ScoreRequest), ScoreResponseDto, ListQueryDto
  transactions.repository.ts      insert (ON CONFLICT) + keyset list + distinctCountries
  transactions.controller.ts      POST /score, GET /transactions
  scoring/
    rules/*.rule.ts               one file per rule; implement Rule.evaluate(ctx)
    scorer.service.ts             merges RuleResults → ScoreOutcome
    idempotency.service.ts        SET NX claim + stored-decision replay
    score.service.ts              orchestrator (the flow above)
```

## Conventions

- Rule name strings are exact: `velocity_card_1m`, `shared_device`, `amount_spike`, `new_geo`.
- Score map lives in `transaction.types.ts`: `decline=0, review=50, approve=100`.
- `Decision` has a single source of truth in `@fraud/shared` — don't redeclare it.
- DTOs that cross the wire `implements` the `@fraud/shared` interface so drift is a compile error.

## Testing

- TDD. Tests sit next to the code (`*.spec.ts`); e2e under `apps/api/test/`.
- Integration/e2e use Testcontainers. **One** Postgres + Redis pair boots for the whole suite
  via `test/global-setup.ts`; `startInfra()` connects to it (it does not start containers).
  Isolation between tests is `flushall` + `TRUNCATE` in `beforeEach`.
- Rules, repository, idempotency are integration tests **on purpose** — their behavior lives in
  Redis/Postgres. Don't "unit-ify" them with mocks; you'd assert the mock, not the logic.
  `scorer.service` is the one pure unit (fake rules).
- **Valid UUIDs in tests that hit ValidationPipe.** `@IsUUID()` rejects malformed UUIDs
  (wrong version/variant nibbles). Use real v4 UUIDs in e2e bodies; service-level tests that
  bypass the pipe can use any string.

## Environment notes

- Docker host: `test/global-setup.ts` and `jest.setup.js` auto-detect a Colima socket and set
  `DOCKER_HOST` + disable the Ryuk reaper. On standard Docker Desktop they no-op.
- Defaults: `PG_URL=postgres://fraud:fraud@localhost:5432/fraud`, `REDIS_URL=redis://localhost:6379`.

## Known follow-ups

- The API's pg pool / redis client (from providers) have no shutdown hook. The e2e harness
  closes them manually; production should add `OnApplicationShutdown` + `enableShutdownHooks`.
