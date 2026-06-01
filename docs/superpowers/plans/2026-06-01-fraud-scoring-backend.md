# Fraud Scoring Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NestJS fraud-scoring backend with a `POST /score` endpoint (dedup + 4 Redis-backed rules + durable Postgres insert) and a `GET /transactions` keyset-paginated listing endpoint, handling ~500 TPS.

**Architecture:** Stateless NestJS API. Redis is the source of truth for sliding-window fraud aggregates (atomic single-key Lua scripts); Postgres is an insert-only durable store for listing. Idempotency is structural — every Redis member deduplicates and scores use `payload.createdAt`, so replays are no-ops. The Postgres insert completes before returning 200 (never-lose). Scoring fails closed (503) when Redis is down.

**Tech Stack:** NestJS 10, TypeScript, `pg` (raw SQL), `ioredis` (Lua via `defineCommand`), `class-validator`/`class-transformer`, Jest + supertest, `@testcontainers/postgresql` + `@testcontainers/redis` for hermetic integration tests, k6 for load testing.

---

## Monorepo layout (npm workspaces)

This repo is an npm-workspaces monorepo. **All backend paths in Tasks 1–14 are relative to `apps/api/`** (e.g. "Create `src/main.ts`" means `apps/api/src/main.ts`). Shared types live in `packages/shared`. The frontend (`apps/web`) is out of scope for this plan. Run backend commands from `apps/api/` unless noted; run `npm install` once from the repo root (workspaces hoist deps).

## File Structure

```
fraud-scoring-backend/                        # repo root (workspaces)
  package.json                                # root: workspaces config
  packages/shared/                            # shared DTO contract (FE + BE import)
    package.json
    src/index.ts                              # ScoreRequest, ScoreResponse, Decision
  apps/web/                                    # frontend (out of scope for this plan)
  apps/api/                                    # === all tasks below live here ===
    docker-compose.yml                         # local postgres + redis
    package.json
    tsconfig.json
    jest.config.js
    test/setup-containers.ts                   # testcontainers boot helper (pg + redis)
    db/migrations/001_create_transactions.sql  # schema
    k6/score-load.js                           # 500 TPS load test
    src/
    main.ts                                  # bootstrap + global ValidationPipe
    app.module.ts
    config/config.module.ts                  # env config
    infra/
      postgres.provider.ts                   # pg Pool provider + migration runner
      redis.provider.ts                      # ioredis client + Lua command defs
    transactions/
      dto/score-request.dto.ts               # input DTO + validation
      dto/score-response.dto.ts              # output shape
      dto/list-query.dto.ts                  # listing query (limit, cursor)
      transaction.types.ts                   # Decision, ScoringContext, RuleResult, StoredTransaction
      transactions.repository.ts             # insert (ON CONFLICT) + keyset list + distinct countries
      transactions.controller.ts             # POST /score, GET /transactions
      transactions.module.ts
      scoring/
        rules/velocity.rule.ts
        rules/shared-device.rule.ts
        rules/amount-spike.rule.ts
        rules/new-geo.rule.ts
        rules/rule.interface.ts              # Rule interface
        scorer.service.ts                    # run rules, merge to decision
        idempotency.service.ts               # SETNX claim + stored-decision replay
        score.service.ts                     # orchestrates dedup -> score -> persist
```

**Decomposition rationale:** one file per rule (each is independently testable against Redis), a thin `scorer` that only merges results, an `idempotency` service isolating the dedup protocol, and a `score.service` orchestrator. The repository owns all SQL. Infra providers isolate `pg`/`ioredis` wiring so rules depend on a client, not on bootstrapping.

---

## Conventions

- **Rule names** (exact strings in `triggeredRules`): `velocity_card_1m`, `shared_device`, `amount_spike`, `new_geo`.
- **Score map:** `decline=0`, `review=50`, `approve=100`.
- **Redis keys:** `card:{cardToken}`, `dev:{fingerprint}`, `amt:{customerId}`, `geo:{customerId}`, `idem:{transactionId}`.
- **ZSET scores** = `createdAt` epoch ms (deterministic). Amount ZSET stores members `"{amount}|{txId}"` scored by `createdAt` ms.
- Run all commands from repo root `fraud-scoring-backend/`.

---

## Task R: Monorepo root + shared package

**Files (at repo root, NOT under apps/api):**
- Create: `package.json` (root), `packages/shared/package.json`, `packages/shared/src/index.ts`

- [ ] **Step 1: Create the root workspace `package.json`**

```json
{
  "name": "fraud-scoring",
  "private": true,
  "workspaces": ["packages/*", "apps/*"]
}
```

- [ ] **Step 2: Create the shared package manifest (`packages/shared/package.json`)**

```json
{
  "name": "@fraud/shared",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 3: Create the shared DTO contract (`packages/shared/src/index.ts`)**

```ts
// The wire contract shared by the API and the frontend. Keep framework-free.
export type Decision = 'approve' | 'review' | 'decline';

export interface ScoreRequest {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string;
  country: string;
  deviceFingerprint?: string;
  createdAt: string; // ISO-8601
}

export interface ScoreResponse {
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface TransactionListItem extends ScoreResponse {
  id: string;
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip: string | null;
  country: string;
  deviceFingerprint: string | null;
  createdAt: string;
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextCursor: number | null;
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json packages/shared
git commit -m "chore: monorepo root with shared dto contract"
```

---

## Task 0: API project scaffold

**Files (all under `apps/api/`):**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/jest.config.js`, `apps/api/docker-compose.yml`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@fraud/api",
  "version": "0.1.0",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest --runInBand",
    "test:e2e": "jest --runInBand --config jest.config.js"
  },
  "dependencies": {
    "@fraud/shared": "*",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/testing": "^10.4.0",
    "@testcontainers/postgresql": "^10.13.0",
    "@testcontainers/redis": "^10.13.0",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.6",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "outDir": "./dist",
    "rootDir": "../../",
    "baseUrl": ".",
    "paths": { "@fraud/shared": ["../../packages/shared/src/index.ts"] },
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false
  },
  "include": ["src/**/*", "test/**/*", "../../packages/shared/src/**/*"]
}
```

The `paths` mapping + `include` let `tsc`, `ts-jest`, and Nest resolve `@fraud/shared` from TypeScript source (the shared package ships `.ts`, no build step).

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  testTimeout: 120000,
};
```

- [ ] **Step 4: Create `docker-compose.yml`** (local run; tests use testcontainers)

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: fraud
      POSTGRES_PASSWORD: fraud
      POSTGRES_DB: fraud
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```

- [ ] **Step 5: Create `src/main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(3000);
}
bootstrap();
```

- [ ] **Step 6: Create `src/app.module.ts`** (placeholder module; expanded in later tasks)

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```

- [ ] **Step 7: Install (from repo root) and verify build**

Run: `cd ../.. && npm install && cd apps/api && npx tsc --noEmit`
Expected: no type errors. (Install runs once at the root; workspaces hoist and symlink `@fraud/shared`.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold nestjs project"
```

---

## Task 1: Postgres schema migration

**Files:**
- Create: `db/migrations/001_create_transactions.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  UUID        NOT NULL,
  card_token      TEXT        NOT NULL,
  customer_id     TEXT        NOT NULL,
  amount          NUMERIC(18,2) NOT NULL,
  currency        CHAR(3)     NOT NULL,
  ip              INET,
  country         TEXT        NOT NULL,
  device_fingerprint TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  decision        TEXT        NOT NULL,
  score           SMALLINT    NOT NULL,
  triggered_rules TEXT[]      NOT NULL DEFAULT '{}',
  evaluated_at    TIMESTAMPTZ NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transaction_id UNIQUE (transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_id_desc ON transactions (id DESC);
CREATE INDEX IF NOT EXISTS idx_tx_customer_country ON transactions (customer_id, country);
```

(The `idx_tx_customer_country` index supports the geo cold-miss rebuild query.)

- [ ] **Step 2: Commit**

```bash
git add db/migrations/001_create_transactions.sql
git commit -m "feat: add transactions table migration"
```

---

## Task 2: Testcontainers harness + infra providers

**Files:**
- Create: `test/setup-containers.ts`, `src/config/config.module.ts`, `src/infra/postgres.provider.ts`, `src/infra/redis.provider.ts`

- [ ] **Step 1: Create config tokens (`src/config/config.module.ts`)**

```ts
import { Module, Global } from '@nestjs/common';

export const PG_POOL = 'PG_POOL';
export const REDIS = 'REDIS';

export interface AppConfig {
  pgUrl: string;
  redisUrl: string;
}

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => ({
        pgUrl: process.env.PG_URL ?? 'postgres://fraud:fraud@localhost:5432/fraud',
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
      }),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```

- [ ] **Step 2: Create Postgres provider with migration runner (`src/infra/postgres.provider.ts`)**

```ts
import { Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_CONFIG, AppConfig, PG_POOL } from '../config/config.module';

export async function runMigrations(pool: Pool): Promise<void> {
  const sql = readFileSync(
    join(process.cwd(), 'db/migrations/001_create_transactions.sql'),
    'utf8',
  );
  await pool.query(sql);
}

export const postgresProvider: Provider = {
  provide: PG_POOL,
  inject: [APP_CONFIG],
  useFactory: async (cfg: AppConfig) => {
    const pool = new Pool({ connectionString: cfg.pgUrl, max: 20 });
    await runMigrations(pool);
    return pool;
  },
};
```

- [ ] **Step 3: Create Redis provider with Lua command definitions (`src/infra/redis.provider.ts`)**

```ts
import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig, REDIS } from '../config/config.module';

// Sliding-window counter: ZADD member, evict outside window, refresh TTL, return ZCARD.
// KEYS[1]=key  ARGV[1]=member ARGV[2]=scoreMs ARGV[3]=windowMs ARGV[4]=ttlSec
const SLIDING_COUNT = `
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[2]) - tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[1], ARGV[4])
return redis.call('ZCARD', KEYS[1])
`;

// Sliding-window value list (for median): ZADD, evict, TTL, return all members.
// KEYS[1]=key ARGV[1]=member("amount|txId") ARGV[2]=scoreMs ARGV[3]=windowMs ARGV[4]=ttlSec
const SLIDING_MEMBERS = `
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[2]) - tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[1], ARGV[4])
return redis.call('ZRANGE', KEYS[1], 0, -1)
`;

export interface FraudRedis extends Redis {
  slidingCount(key: string, member: string, scoreMs: string, windowMs: string, ttlSec: string): Promise<number>;
  slidingMembers(key: string, member: string, scoreMs: string, windowMs: string, ttlSec: string): Promise<string[]>;
}

export function defineFraudCommands(client: Redis): FraudRedis {
  client.defineCommand('slidingCount', { numberOfKeys: 1, lua: SLIDING_COUNT });
  client.defineCommand('slidingMembers', { numberOfKeys: 1, lua: SLIDING_MEMBERS });
  return client as FraudRedis;
}

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): FraudRedis => {
    const client = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 1 });
    return defineFraudCommands(client);
  },
};
```

- [ ] **Step 4: Create the testcontainers harness (`test/setup-containers.ts`)**

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import { runMigrations } from '../src/infra/postgres.provider';
import { defineFraudCommands, FraudRedis } from '../src/infra/redis.provider';
import Redis from 'ioredis';

export interface TestInfra {
  pg: Pool;
  redis: FraudRedis;
  pgUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

export async function startInfra(): Promise<TestInfra> {
  const pgC: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16').start();
  const redisC: StartedRedisContainer = await new RedisContainer('redis:7').start();
  const pgUrl = pgC.getConnectionUri();
  const redisUrl = redisC.getConnectionUrl();
  const pg = new Pool({ connectionString: pgUrl });
  await runMigrations(pg);
  const redis = defineFraudCommands(new Redis(redisUrl, { maxRetriesPerRequest: 1 }));
  return {
    pg, redis, pgUrl, redisUrl,
    stop: async () => {
      await pg.end();
      redis.disconnect();
      await pgC.stop();
      await redisC.stop();
    },
  };
}
```

- [ ] **Step 5: Write a smoke test to prove infra boots (`test/infra.spec.ts`)**

```ts
import { startInfra, TestInfra } from './setup-containers';

describe('infra', () => {
  let infra: TestInfra;
  beforeAll(async () => { infra = await startInfra(); });
  afterAll(async () => { await infra.stop(); });

  it('postgres has transactions table', async () => {
    const r = await infra.pg.query("SELECT to_regclass('transactions') AS t");
    expect(r.rows[0].t).toBe('transactions');
  });

  it('redis responds to ping', async () => {
    expect(await infra.redis.ping()).toBe('PONG');
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm test -- test/infra.spec.ts`
Expected: PASS (requires Docker running).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add infra providers and testcontainers harness"
```

---

## Task 3: Core types + DTOs

**Files:**
- Create: `src/transactions/transaction.types.ts`, `src/transactions/dto/score-request.dto.ts`, `src/transactions/dto/score-response.dto.ts`, `src/transactions/dto/list-query.dto.ts`

- [ ] **Step 1: Create core types (`src/transactions/transaction.types.ts`)**

```ts
import { Decision } from '@fraud/shared';
export { Decision };

export const SCORE_BY_DECISION: Record<Decision, number> = {
  decline: 0,
  review: 50,
  approve: 100,
};

// Severity ordering: lower index = worse. Used to merge rule outcomes.
export const DECISION_SEVERITY: Decision[] = ['decline', 'review', 'approve'];

export interface ScoringContext {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string;
  country: string;
  deviceFingerprint?: string;
  createdAtMs: number; // epoch ms parsed from payload.createdAt
}

export interface RuleResult {
  triggered: boolean;
  ruleName: string;
  // The decision this rule implies WHEN triggered.
  severity: Decision;
}

export interface ScoreOutcome {
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface StoredTransaction {
  id: string;
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip: string | null;
  country: string;
  deviceFingerprint: string | null;
  createdAt: string;
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string;
}
```

- [ ] **Step 2: Create the input DTO (`src/transactions/dto/score-request.dto.ts`)**

```ts
import {
  IsUUID, IsString, IsNumber, IsISO8601, IsOptional, IsIP, Length, Min,
} from 'class-validator';
import { ScoreRequest } from '@fraud/shared';

// implements ScoreRequest => compile error if the wire contract drifts.
export class ScoreRequestDto implements ScoreRequest {
  @IsUUID()
  transactionId!: string;

  @IsString()
  cardToken!: string;

  @IsString()
  customerId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsIP()
  ip?: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsISO8601()
  createdAt!: string;
}
```

- [ ] **Step 3: Create the output DTO (`src/transactions/dto/score-response.dto.ts`)**

```ts
import { ScoreResponse, Decision } from '@fraud/shared';

export class ScoreResponseDto implements ScoreResponse {
  decision!: Decision;
  score!: number;
  triggeredRules!: string[];
  evaluatedAt!: string;
}
```

Keep the local `Decision` in `transaction.types.ts` re-exported from `@fraud/shared` to avoid two sources of truth:
```ts
// at the top of src/transactions/transaction.types.ts
export { Decision } from '@fraud/shared';
```
(Remove the local `export type Decision = ...` line defined in Task 3 Step 1 and use this re-export instead.)

- [ ] **Step 4: Create the listing query DTO (`src/transactions/dto/list-query.dto.ts`)**

```ts
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/transactions
git commit -m "feat: add transaction types and DTOs"
```

---

## Task 4: Rule interface + velocity rule

**Files:**
- Create: `src/transactions/scoring/rules/rule.interface.ts`, `src/transactions/scoring/rules/velocity.rule.ts`, `src/transactions/scoring/rules/velocity.rule.spec.ts`

- [ ] **Step 1: Create the Rule interface (`rule.interface.ts`)**

```ts
import { ScoringContext, RuleResult } from '../../transaction.types';

export interface Rule {
  evaluate(ctx: ScoringContext): Promise<RuleResult>;
}
```

- [ ] **Step 2: Write the failing test (`velocity.rule.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { VelocityRule } from './velocity.rule';
import { ScoringContext } from '../../transaction.types';

const baseCtx = (over: Partial<ScoringContext>): ScoringContext => ({
  transactionId: '', cardToken: 'card-A', customerId: 'cust-1', amount: 10,
  currency: 'USD', country: 'US', createdAtMs: 1_000_000, ...over,
});

describe('VelocityRule', () => {
  let infra: TestInfra;
  let rule: VelocityRule;
  beforeAll(async () => { infra = await startInfra(); rule = new VelocityRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger at 5 transactions in the window', async () => {
    let res;
    for (let i = 0; i < 5; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    expect(res!.triggered).toBe(false);
  });

  it('triggers decline at the 6th transaction within 60s', async () => {
    let res;
    for (let i = 0; i < 6; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    expect(res!.triggered).toBe(true);
    expect(res!.severity).toBe('decline');
    expect(res!.ruleName).toBe('velocity_card_1m');
  });

  it('is idempotent: replaying the same txId does not inflate the count', async () => {
    for (let i = 0; i < 5; i++) {
      await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    // replay t0 four times
    let res;
    for (let k = 0; k < 4; k++) {
      res = await rule.evaluate(baseCtx({ transactionId: 't0', createdAtMs: 1_000_000 }));
    }
    expect(res!.triggered).toBe(false); // still 5 distinct members
  });

  it('evicts transactions older than 60s', async () => {
    await rule.evaluate(baseCtx({ transactionId: 'old', createdAtMs: 1_000_000 }));
    let res;
    for (let i = 0; i < 5; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `n${i}`, createdAtMs: 1_000_000 + 61_000 + i }));
    }
    expect(res!.triggered).toBe(false); // 'old' evicted, only 5 in window
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/rules/velocity.rule.spec.ts`
Expected: FAIL ("Cannot find module './velocity.rule'").

- [ ] **Step 4: Implement the velocity rule (`velocity.rule.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../../config/config.module';
import { FraudRedis } from '../../../infra/redis.provider';
import { Rule } from './rule.interface';
import { ScoringContext, RuleResult } from '../../transaction.types';

const WINDOW_MS = 60_000;
const TTL_SEC = 300;
const THRESHOLD = 5; // strictly greater than 5 => decline

@Injectable()
export class VelocityRule implements Rule {
  constructor(@Inject(REDIS) private readonly redis: FraudRedis) {}

  async evaluate(ctx: ScoringContext): Promise<RuleResult> {
    const count = await this.redis.slidingCount(
      `card:${ctx.cardToken}`,
      ctx.transactionId,
      String(ctx.createdAtMs),
      String(WINDOW_MS),
      String(TTL_SEC),
    );
    return { triggered: count > THRESHOLD, ruleName: 'velocity_card_1m', severity: 'decline' };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/rules/velocity.rule.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/transactions/scoring/rules
git commit -m "feat: add velocity rule"
```

---

## Task 5: Shared-device rule

**Files:**
- Create: `src/transactions/scoring/rules/shared-device.rule.ts`, `src/transactions/scoring/rules/shared-device.rule.spec.ts`

- [ ] **Step 1: Write the failing test (`shared-device.rule.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { SharedDeviceRule } from './shared-device.rule';
import { ScoringContext } from '../../transaction.types';

const ctx = (customerId: string, createdAtMs: number): ScoringContext => ({
  transactionId: `${customerId}-${createdAtMs}`, cardToken: 'c', customerId, amount: 10,
  currency: 'USD', country: 'US', deviceFingerprint: 'fp-1', createdAtMs,
});

describe('SharedDeviceRule', () => {
  let infra: TestInfra;
  let rule: SharedDeviceRule;
  beforeAll(async () => { infra = await startInfra(); rule = new SharedDeviceRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger for 3 distinct customers on one device', async () => {
    let res;
    for (const c of ['a', 'b', 'c']) res = await rule.evaluate(ctx(c, 1_000_000));
    expect(res!.triggered).toBe(false);
  });

  it('triggers decline at the 4th distinct customer within 24h', async () => {
    let res;
    for (const c of ['a', 'b', 'c', 'd']) res = await rule.evaluate(ctx(c, 1_000_000));
    expect(res!.triggered).toBe(true);
    expect(res!.severity).toBe('decline');
    expect(res!.ruleName).toBe('shared_device');
  });

  it('counts distinct customers, not transactions (same customer repeats)', async () => {
    let res;
    for (let i = 0; i < 10; i++) res = await rule.evaluate(ctx('a', 1_000_000 + i));
    expect(res!.triggered).toBe(false); // 1 distinct customer
  });

  it('does not trigger when deviceFingerprint is absent', async () => {
    const res = await rule.evaluate({ ...ctx('a', 1_000_000), deviceFingerprint: undefined });
    expect(res.triggered).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/rules/shared-device.rule.spec.ts`
Expected: FAIL ("Cannot find module './shared-device.rule'").

- [ ] **Step 3: Implement the shared-device rule (`shared-device.rule.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../../config/config.module';
import { FraudRedis } from '../../../infra/redis.provider';
import { Rule } from './rule.interface';
import { ScoringContext, RuleResult } from '../../transaction.types';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const TTL_SEC = 24 * 60 * 60;
const THRESHOLD = 3; // strictly greater than 3 distinct customers => decline

@Injectable()
export class SharedDeviceRule implements Rule {
  constructor(@Inject(REDIS) private readonly redis: FraudRedis) {}

  async evaluate(ctx: ScoringContext): Promise<RuleResult> {
    const result: RuleResult = { triggered: false, ruleName: 'shared_device', severity: 'decline' };
    if (!ctx.deviceFingerprint) return result;
    const distinct = await this.redis.slidingCount(
      `dev:${ctx.deviceFingerprint}`,
      ctx.customerId, // member = customerId => ZCARD = distinct customers
      String(ctx.createdAtMs),
      String(WINDOW_MS),
      String(TTL_SEC),
    );
    result.triggered = distinct > THRESHOLD;
    return result;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/rules/shared-device.rule.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/scoring/rules/shared-device.rule.ts src/transactions/scoring/rules/shared-device.rule.spec.ts
git commit -m "feat: add shared-device rule"
```

---

## Task 6: Amount-spike rule (median)

**Files:**
- Create: `src/transactions/scoring/rules/amount-spike.rule.ts`, `src/transactions/scoring/rules/amount-spike.rule.spec.ts`

- [ ] **Step 1: Write the failing test (`amount-spike.rule.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { AmountSpikeRule } from './amount-spike.rule';
import { ScoringContext } from '../../transaction.types';

const ctx = (txId: string, amount: number, createdAtMs: number): ScoringContext => ({
  transactionId: txId, cardToken: 'c', customerId: 'cust-1', amount,
  currency: 'USD', country: 'US', createdAtMs,
});

describe('AmountSpikeRule', () => {
  let infra: TestInfra;
  let rule: AmountSpikeRule;
  beforeAll(async () => { infra = await startInfra(); rule = new AmountSpikeRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger with fewer than 2 prior transactions', async () => {
    const r1 = await rule.evaluate(ctx('t1', 10, 1_000_000));
    const r2 = await rule.evaluate(ctx('t2', 10_000, 1_000_001)); // 1 prior only
    expect(r1.triggered).toBe(false);
    expect(r2.triggered).toBe(false);
  });

  it('triggers review when amount > 10x median of prior txns', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002)); // prior median = 20
    const res = await rule.evaluate(ctx('t4', 201, 1_000_003)); // 201 > 10*20
    expect(res.triggered).toBe(true);
    expect(res.severity).toBe('review');
    expect(res.ruleName).toBe('amount_spike');
  });

  it('does not trigger when amount is within 10x median', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002)); // prior median = 20
    const res = await rule.evaluate(ctx('t4', 199, 1_000_003)); // 199 < 10*20=200
    expect(res.triggered).toBe(false);
  });

  it('is idempotent on replay (same txId|amount member)', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002));
    const a = await rule.evaluate(ctx('t4', 201, 1_000_003));
    const b = await rule.evaluate(ctx('t4', 201, 1_000_003)); // replay
    expect(a.triggered).toBe(true);
    expect(b.triggered).toBe(true); // unchanged
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/rules/amount-spike.rule.spec.ts`
Expected: FAIL ("Cannot find module './amount-spike.rule'").

- [ ] **Step 3: Implement the amount-spike rule (`amount-spike.rule.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../../config/config.module';
import { FraudRedis } from '../../../infra/redis.provider';
import { Rule } from './rule.interface';
import { ScoringContext, RuleResult } from '../../transaction.types';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const TTL_SEC = 24 * 60 * 60;
const MULTIPLIER = 10;
const MIN_PRIOR = 2; // need >= 2 prior txns for a meaningful median

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

@Injectable()
export class AmountSpikeRule implements Rule {
  constructor(@Inject(REDIS) private readonly redis: FraudRedis) {}

  async evaluate(ctx: ScoringContext): Promise<RuleResult> {
    const result: RuleResult = { triggered: false, ruleName: 'amount_spike', severity: 'review' };
    const member = `${ctx.amount}|${ctx.transactionId}`;
    const members = await this.redis.slidingMembers(
      `amt:${ctx.customerId}`,
      member,
      String(ctx.createdAtMs),
      String(WINDOW_MS),
      String(TTL_SEC),
    );
    // Prior amounts = all members except the current transaction.
    const priorAmounts = members
      .filter((m) => m !== member && !m.endsWith(`|${ctx.transactionId}`))
      .map((m) => Number(m.split('|')[0]));
    if (priorAmounts.length < MIN_PRIOR) return result;
    result.triggered = ctx.amount > MULTIPLIER * median(priorAmounts);
    return result;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/rules/amount-spike.rule.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/scoring/rules/amount-spike.rule.ts src/transactions/scoring/rules/amount-spike.rule.spec.ts
git commit -m "feat: add amount-spike rule with median"
```

---

## Task 7: New-geo rule (with Postgres cold-miss rebuild)

**Files:**
- Create: `src/transactions/transactions.repository.ts` (partial: `distinctCountries`), `src/transactions/scoring/rules/new-geo.rule.ts`, `src/transactions/scoring/rules/new-geo.rule.spec.ts`

- [ ] **Step 1: Create the repository with `distinctCountries` (`transactions.repository.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config/config.module';

@Injectable()
export class TransactionsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async distinctCountries(customerId: string): Promise<string[]> {
    const r = await this.pool.query<{ country: string }>(
      'SELECT DISTINCT country FROM transactions WHERE customer_id = $1',
      [customerId],
    );
    return r.rows.map((x) => x.country);
  }
}
```

- [ ] **Step 2: Write the failing test (`new-geo.rule.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { NewGeoRule } from './new-geo.rule';
import { TransactionsRepository } from '../../transactions.repository';
import { ScoringContext } from '../../transaction.types';

const ctx = (country: string, amount: number): ScoringContext => ({
  transactionId: `${country}-${amount}`, cardToken: 'c', customerId: 'cust-1', amount,
  currency: 'USD', country, createdAtMs: 1_000_000,
});

describe('NewGeoRule', () => {
  let infra: TestInfra;
  let rule: NewGeoRule;
  beforeAll(async () => {
    infra = await startInfra();
    rule = new NewGeoRule(infra.redis, new TransactionsRepository(infra.pg as any));
  });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  it('triggers review for a new country with amount > 500', async () => {
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(true);
    expect(res.severity).toBe('review');
    expect(res.ruleName).toBe('new_geo');
  });

  it('does not trigger for a new country with amount <= 500', async () => {
    const res = await rule.evaluate(ctx('US', 500));
    expect(res.triggered).toBe(false);
  });

  it('does not trigger for an already-seen country', async () => {
    await rule.evaluate(ctx('US', 600)); // US now recorded
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(false);
  });

  it('rebuilds the geo set from Postgres on a cold Redis miss', async () => {
    await infra.pg.query(
      `INSERT INTO transactions
       (transaction_id, card_token, customer_id, amount, currency, country, created_at, decision, score, evaluated_at)
       VALUES (gen_random_uuid(), 'c', 'cust-1', 10, 'USD', 'US', now(), 'approve', 100, now())`,
    );
    // Redis is empty (cold). US is historically known via Postgres => not new.
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/rules/new-geo.rule.spec.ts`
Expected: FAIL ("Cannot find module './new-geo.rule'").

- [ ] **Step 4: Implement the new-geo rule (`new-geo.rule.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../../config/config.module';
import { FraudRedis } from '../../../infra/redis.provider';
import { Rule } from './rule.interface';
import { ScoringContext, RuleResult } from '../../transaction.types';
import { TransactionsRepository } from '../../transactions.repository';

const BIG_AMOUNT = 500; // strictly greater than 500

@Injectable()
export class NewGeoRule implements Rule {
  constructor(
    @Inject(REDIS) private readonly redis: FraudRedis,
    private readonly repo: TransactionsRepository,
  ) {}

  async evaluate(ctx: ScoringContext): Promise<RuleResult> {
    const key = `geo:${ctx.customerId}`;
    // Cold-miss rebuild: if the key is absent, repopulate from the durable store.
    const exists = await this.redis.exists(key);
    if (!exists) {
      const countries = await this.repo.distinctCountries(ctx.customerId);
      if (countries.length > 0) await this.redis.sadd(key, ...countries);
    }
    // SADD returns 1 when the country was newly added (i.e. previously unseen).
    const added = await this.redis.sadd(key, ctx.country);
    const isNew = added === 1;
    return {
      triggered: isNew && ctx.amount > BIG_AMOUNT,
      ruleName: 'new_geo',
      severity: 'review',
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/rules/new-geo.rule.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/transactions/scoring/rules/new-geo.rule.ts src/transactions/scoring/rules/new-geo.rule.spec.ts src/transactions/transactions.repository.ts
git commit -m "feat: add new-geo rule with postgres cold-miss rebuild"
```

---

## Task 8: Scorer service (merge rules → decision)

**Files:**
- Create: `src/transactions/scoring/scorer.service.ts`, `src/transactions/scoring/scorer.service.spec.ts`

- [ ] **Step 1: Write the failing test (`scorer.service.spec.ts`)** — pure unit test with fake rules

```ts
import { ScorerService } from './scorer.service';
import { Rule } from './rules/rule.interface';
import { RuleResult, ScoringContext } from '../transaction.types';

const fakeRule = (r: RuleResult): Rule => ({ evaluate: async () => r });
const ctx = {} as ScoringContext;

describe('ScorerService', () => {
  it('approves (score 100) when no rule triggers', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: false, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: false, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('approve');
    expect(out.score).toBe(100);
    expect(out.triggeredRules).toEqual([]);
  });

  it('reviews (score 50) when only a review rule triggers', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: false, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: true, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('review');
    expect(out.score).toBe(50);
    expect(out.triggeredRules).toEqual(['new_geo']);
  });

  it('declines (score 0) when a decline rule triggers, even alongside a review rule', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: true, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: true, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('decline');
    expect(out.score).toBe(0);
    expect(out.triggeredRules).toEqual(['velocity_card_1m', 'new_geo']);
  });

  it('includes an ISO-8601 evaluatedAt timestamp', async () => {
    const svc = new ScorerService([]);
    const out = await svc.score(ctx);
    expect(() => new Date(out.evaluatedAt).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/scorer.service.spec.ts`
Expected: FAIL ("Cannot find module './scorer.service'").

- [ ] **Step 3: Implement the scorer service (`scorer.service.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Rule } from './rules/rule.interface';
import {
  ScoringContext, ScoreOutcome, Decision, SCORE_BY_DECISION, DECISION_SEVERITY,
} from '../transaction.types';

export const RULES = 'RULES';

@Injectable()
export class ScorerService {
  constructor(@Inject(RULES) private readonly rules: Rule[]) {}

  async score(ctx: ScoringContext): Promise<ScoreOutcome> {
    const results = await Promise.all(this.rules.map((r) => r.evaluate(ctx)));
    const triggered = results.filter((r) => r.triggered);
    const triggeredRules = triggered.map((r) => r.ruleName);

    // Worst severity wins. Default to approve when nothing fires.
    let decision: Decision = 'approve';
    for (const r of triggered) {
      if (DECISION_SEVERITY.indexOf(r.severity) < DECISION_SEVERITY.indexOf(decision)) {
        decision = r.severity;
      }
    }

    return {
      decision,
      score: SCORE_BY_DECISION[decision],
      triggeredRules,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/scorer.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/scoring/scorer.service.ts src/transactions/scoring/scorer.service.spec.ts
git commit -m "feat: add scorer service merging rules to a decision"
```

---

## Task 9: Idempotency service

**Files:**
- Create: `src/transactions/scoring/idempotency.service.ts`, `src/transactions/scoring/idempotency.service.spec.ts`

- [ ] **Step 1: Write the failing test (`idempotency.service.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../../test/setup-containers';
import { IdempotencyService } from './idempotency.service';
import { ScoreOutcome } from '../transaction.types';

const outcome: ScoreOutcome = {
  decision: 'review', score: 50, triggeredRules: ['new_geo'], evaluatedAt: '2026-06-01T00:00:00.000Z',
};

describe('IdempotencyService', () => {
  let infra: TestInfra;
  let svc: IdempotencyService;
  beforeAll(async () => { infra = await startInfra(); svc = new IdempotencyService(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('claims a fresh transactionId', async () => {
    expect(await svc.claim('tx-1')).toBe('claimed');
  });

  it('returns the stored outcome on replay after completion', async () => {
    await svc.claim('tx-1');
    await svc.complete('tx-1', outcome);
    const replay = await svc.claim('tx-1');
    expect(replay).toEqual({ status: 'duplicate', outcome });
  });

  it('reports a pending claim when still in-flight', async () => {
    await svc.claim('tx-1'); // claimed, not completed
    expect(await svc.claim('tx-1')).toBe('pending');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/idempotency.service.spec.ts`
Expected: FAIL ("Cannot find module './idempotency.service'").

- [ ] **Step 3: Implement the idempotency service (`idempotency.service.ts`)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../config/config.module';
import { FraudRedis } from '../../infra/redis.provider';
import { ScoreOutcome } from '../transaction.types';

const TTL_SEC = 24 * 60 * 60;
const PENDING = 'pending';

export type ClaimResult =
  | 'claimed'
  | 'pending'
  | { status: 'duplicate'; outcome: ScoreOutcome };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: FraudRedis) {}

  private key(txId: string) { return `idem:${txId}`; }

  async claim(txId: string): Promise<ClaimResult> {
    const ok = await this.redis.set(this.key(txId), PENDING, 'EX', TTL_SEC, 'NX');
    if (ok === 'OK') return 'claimed';
    const current = await this.redis.get(this.key(txId));
    if (!current || current === PENDING) return 'pending';
    return { status: 'duplicate', outcome: JSON.parse(current) as ScoreOutcome };
  }

  async complete(txId: string, outcome: ScoreOutcome): Promise<void> {
    await this.redis.set(this.key(txId), JSON.stringify(outcome), 'EX', TTL_SEC);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/idempotency.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/scoring/idempotency.service.ts src/transactions/scoring/idempotency.service.spec.ts
git commit -m "feat: add idempotency service"
```

---

## Task 10: Repository insert + listing

**Files:**
- Modify: `src/transactions/transactions.repository.ts`
- Create: `src/transactions/transactions.repository.spec.ts`

- [ ] **Step 1: Write the failing test (`transactions.repository.spec.ts`)**

```ts
import { startInfra, TestInfra } from '../../test/setup-containers';
import { TransactionsRepository } from './transactions.repository';

const row = (txId: string, country = 'US') => ({
  transactionId: txId, cardToken: 'c', customerId: 'cust-1', amount: 12.5, currency: 'USD',
  ip: '1.2.3.4', country, deviceFingerprint: 'fp', createdAt: '2026-06-01T00:00:00.000Z',
  decision: 'approve' as const, score: 100, triggeredRules: [], evaluatedAt: '2026-06-01T00:00:01.000Z',
});

describe('TransactionsRepository', () => {
  let infra: TestInfra;
  let repo: TransactionsRepository;
  beforeAll(async () => { infra = await startInfra(); repo = new TransactionsRepository(infra.pg as any); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.pg.query('TRUNCATE transactions'); });

  it('inserts a transaction', async () => {
    await repo.insert(row('11111111-1111-1111-1111-111111111111'));
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('is idempotent: ON CONFLICT DO NOTHING on duplicate transaction_id', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    await repo.insert(row(id));
    await repo.insert(row(id)); // duplicate
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('lists newest first with keyset pagination', async () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
    ];
    for (const id of ids) await repo.insert(row(id));

    const page1 = await repo.list(2, undefined);
    expect(page1.items.length).toBe(2);
    expect(page1.items[0].transactionId).toBe(ids[2]); // newest id first
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.list(2, page1.nextCursor!);
    expect(page2.items.length).toBe(1);
    expect(page2.items[0].transactionId).toBe(ids[0]);
    expect(page2.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/transactions.repository.spec.ts`
Expected: FAIL ("repo.insert is not a function").

- [ ] **Step 3: Extend the repository with `insert` and `list` (`transactions.repository.ts`)**

Replace the file contents with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config/config.module';
import { Decision, StoredTransaction } from './transaction.types';

export interface InsertInput {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string | null;
  country: string;
  deviceFingerprint?: string | null;
  createdAt: string;
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string;
}

export interface ListPage {
  items: StoredTransaction[];
  nextCursor: number | null;
}

const COLUMNS = `
  id, transaction_id, card_token, customer_id, amount, currency, ip, country,
  device_fingerprint, created_at, decision, score, triggered_rules, evaluated_at`;

@Injectable()
export class TransactionsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async distinctCountries(customerId: string): Promise<string[]> {
    const r = await this.pool.query<{ country: string }>(
      'SELECT DISTINCT country FROM transactions WHERE customer_id = $1',
      [customerId],
    );
    return r.rows.map((x) => x.country);
  }

  async insert(input: InsertInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO transactions
        (transaction_id, card_token, customer_id, amount, currency, ip, country,
         device_fingerprint, created_at, decision, score, triggered_rules, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        input.transactionId, input.cardToken, input.customerId, input.amount, input.currency,
        input.ip ?? null, input.country, input.deviceFingerprint ?? null, input.createdAt,
        input.decision, input.score, input.triggeredRules, input.evaluatedAt,
      ],
    );
  }

  async list(limit: number, cursor?: number): Promise<ListPage> {
    const params: unknown[] = [];
    let where = '';
    if (cursor !== undefined) { params.push(cursor); where = `WHERE id < $1`; }
    params.push(limit + 1);
    const r = await this.pool.query(
      `SELECT ${COLUMNS} FROM transactions ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const rows = r.rows.map(this.map);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? Number(items[items.length - 1].id) : null;
    return { items, nextCursor };
  }

  private map = (row: any): StoredTransaction => ({
    id: String(row.id),
    transactionId: row.transaction_id,
    cardToken: row.card_token,
    customerId: row.customer_id,
    amount: Number(row.amount),
    currency: row.currency.trim(),
    ip: row.ip,
    country: row.country,
    deviceFingerprint: row.device_fingerprint,
    createdAt: new Date(row.created_at).toISOString(),
    decision: row.decision,
    score: row.score,
    triggeredRules: row.triggered_rules,
    evaluatedAt: new Date(row.evaluated_at).toISOString(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/transactions.repository.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the new-geo rule test again to confirm no regression**

Run: `npm test -- src/transactions/scoring/rules/new-geo.rule.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/transactions/transactions.repository.ts src/transactions/transactions.repository.spec.ts
git commit -m "feat: add transaction insert and keyset listing"
```

---

## Task 11: Score orchestration service

**Files:**
- Create: `src/transactions/scoring/score.service.ts`, `src/transactions/scoring/score.service.spec.ts`

- [ ] **Step 1: Write the failing test (`score.service.spec.ts`)** — wires real services against testcontainers

```ts
import { startInfra, TestInfra } from '../../../test/setup-containers';
import { ScoreService, RedisUnavailableError } from './score.service';
import { ScorerService } from './scorer.service';
import { IdempotencyService } from './idempotency.service';
import { TransactionsRepository } from '../transactions.repository';
import { VelocityRule } from './rules/velocity.rule';
import { SharedDeviceRule } from './rules/shared-device.rule';
import { AmountSpikeRule } from './rules/amount-spike.rule';
import { NewGeoRule } from './rules/new-geo.rule';
import { ScoreRequestDto } from '../dto/score-request.dto';

const req = (over: Partial<ScoreRequestDto> = {}): ScoreRequestDto => ({
  transactionId: '11111111-1111-1111-1111-111111111111',
  cardToken: 'card-A', customerId: 'cust-1', amount: 100, currency: 'USD',
  ip: '1.2.3.4', country: 'US', deviceFingerprint: 'fp-1',
  createdAt: '2026-06-01T00:00:00.000Z', ...over,
});

function build(infra: TestInfra): ScoreService {
  const repo = new TransactionsRepository(infra.pg as any);
  const scorer = new ScorerService([
    new VelocityRule(infra.redis),
    new SharedDeviceRule(infra.redis),
    new AmountSpikeRule(infra.redis),
    new NewGeoRule(infra.redis, repo),
  ]);
  return new ScoreService(new IdempotencyService(infra.redis), scorer, repo);
}

describe('ScoreService', () => {
  let infra: TestInfra;
  let svc: ScoreService;
  beforeAll(async () => { infra = await startInfra(); svc = build(infra); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  it('approves a clean transaction and persists it', async () => {
    const out = await svc.handle(req());
    expect(out.decision).toBe('approve');
    expect(out.score).toBe(100);
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('returns the stored outcome on duplicate without a second insert', async () => {
    const first = await svc.handle(req());
    const second = await svc.handle(req()); // same transactionId
    expect(second).toEqual(first);
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('declines on card velocity > 5 in a minute', async () => {
    let out;
    for (let i = 0; i < 6; i++) {
      out = await svc.handle(req({
        transactionId: `00000000-0000-0000-0000-00000000000${i}`,
        createdAt: new Date(Date.parse('2026-06-01T00:00:00.000Z') + i).toISOString(),
      }));
    }
    expect(out!.decision).toBe('decline');
    expect(out!.triggeredRules).toContain('velocity_card_1m');
  });

  it('throws RedisUnavailableError when Redis is down (fail closed)', async () => {
    const broken = build({ ...infra, redis: { ...infra.redis,
      // force the first redis call used by claim() to reject
      set: async () => { throw new Error('connection refused'); } } as any);
    await expect(broken.handle(req())).rejects.toBeInstanceOf(RedisUnavailableError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/transactions/scoring/score.service.spec.ts`
Expected: FAIL ("Cannot find module './score.service'").

- [ ] **Step 3: Implement the orchestrator (`score.service.ts`)**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { ScorerService } from './scorer.service';
import { TransactionsRepository } from '../transactions.repository';
import { ScoreRequestDto } from '../dto/score-request.dto';
import { ScoreOutcome, ScoringContext } from '../transaction.types';

export class RedisUnavailableError extends Error {}
export class InFlightError extends Error {}

@Injectable()
export class ScoreService {
  private readonly log = new Logger(ScoreService.name);

  constructor(
    private readonly idem: IdempotencyService,
    private readonly scorer: ScorerService,
    private readonly repo: TransactionsRepository,
  ) {}

  async handle(req: ScoreRequestDto): Promise<ScoreOutcome> {
    let claim;
    try {
      claim = await this.idem.claim(req.transactionId);
    } catch (e) {
      throw new RedisUnavailableError((e as Error).message);
    }
    if (claim === 'pending') throw new InFlightError(req.transactionId);
    if (typeof claim === 'object') return claim.outcome; // duplicate replay

    const ctx: ScoringContext = {
      transactionId: req.transactionId,
      cardToken: req.cardToken,
      customerId: req.customerId,
      amount: req.amount,
      currency: req.currency,
      ip: req.ip,
      country: req.country,
      deviceFingerprint: req.deviceFingerprint,
      createdAtMs: Date.parse(req.createdAt),
    };

    let outcome: ScoreOutcome;
    try {
      outcome = await this.scorer.score(ctx);
    } catch (e) {
      throw new RedisUnavailableError((e as Error).message);
    }

    // Durability point: persist BEFORE marking the idempotency record complete
    // and before returning to the caller.
    await this.repo.insert({
      transactionId: req.transactionId,
      cardToken: req.cardToken,
      customerId: req.customerId,
      amount: req.amount,
      currency: req.currency,
      ip: req.ip,
      country: req.country,
      deviceFingerprint: req.deviceFingerprint,
      createdAt: req.createdAt,
      decision: outcome.decision,
      score: outcome.score,
      triggeredRules: outcome.triggeredRules,
      evaluatedAt: outcome.evaluatedAt,
    });

    await this.idem.complete(req.transactionId, outcome);
    return outcome;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/transactions/scoring/score.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transactions/scoring/score.service.ts src/transactions/scoring/score.service.spec.ts
git commit -m "feat: add score orchestration with fail-closed behavior"
```

---

## Task 12: Controller + module wiring

**Files:**
- Create: `src/transactions/transactions.controller.ts`, `src/transactions/transactions.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Implement the controller (`transactions.controller.ts`)**

```ts
import {
  Body, Controller, Get, HttpCode, Post, Query, ServiceUnavailableException, ConflictException,
} from '@nestjs/common';
import { ScoreRequestDto } from './dto/score-request.dto';
import { ScoreResponseDto } from './dto/score-response.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { ScoreService, RedisUnavailableError, InFlightError } from './scoring/score.service';
import { TransactionsRepository } from './transactions.repository';

@Controller()
export class TransactionsController {
  constructor(
    private readonly scoreService: ScoreService,
    private readonly repo: TransactionsRepository,
  ) {}

  @Post('score')
  @HttpCode(200)
  async score(@Body() body: ScoreRequestDto): Promise<ScoreResponseDto> {
    try {
      return await this.scoreService.handle(body);
    } catch (e) {
      if (e instanceof RedisUnavailableError) {
        throw new ServiceUnavailableException('scoring temporarily unavailable');
      }
      if (e instanceof InFlightError) {
        throw new ConflictException('transaction is being processed');
      }
      throw e;
    }
  }

  @Get('transactions')
  async list(@Query() query: ListQueryDto) {
    return this.repo.list(query.limit, query.cursor);
  }
}
```

- [ ] **Step 2: Wire the module (`transactions.module.ts`)**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { postgresProvider } from '../infra/postgres.provider';
import { redisProvider } from '../infra/redis.provider';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository } from './transactions.repository';
import { ScorerService, RULES } from './scoring/scorer.service';
import { IdempotencyService } from './scoring/idempotency.service';
import { ScoreService } from './scoring/score.service';
import { VelocityRule } from './scoring/rules/velocity.rule';
import { SharedDeviceRule } from './scoring/rules/shared-device.rule';
import { AmountSpikeRule } from './scoring/rules/amount-spike.rule';
import { NewGeoRule } from './scoring/rules/new-geo.rule';

@Module({
  imports: [ConfigModule],
  controllers: [TransactionsController],
  providers: [
    postgresProvider,
    redisProvider,
    TransactionsRepository,
    VelocityRule,
    SharedDeviceRule,
    AmountSpikeRule,
    NewGeoRule,
    IdempotencyService,
    ScoreService,
    {
      provide: RULES,
      inject: [VelocityRule, SharedDeviceRule, AmountSpikeRule, NewGeoRule],
      useFactory: (v, s, a, g) => [v, s, a, g],
    },
    ScorerService,
  ],
})
export class TransactionsModule {}
```

- [ ] **Step 3: Update `app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TransactionsModule } from './transactions/transactions.module';

@Module({ imports: [TransactionsModule] })
export class AppModule {}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/transactions/transactions.controller.ts src/transactions/transactions.module.ts src/app.module.ts
git commit -m "feat: wire controller and transactions module"
```

---

## Task 13: End-to-end HTTP test

**Files:**
- Create: `test/score.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test (`test/score.e2e-spec.ts`)**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { startInfra, TestInfra } from './setup-containers';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config.module';

describe('POST /score & GET /transactions (e2e)', () => {
  let infra: TestInfra;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startInfra();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ pgUrl: infra.pgUrl, redisUrl: infra.redisUrl })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  const body = (over = {}) => ({
    transactionId: '11111111-1111-1111-1111-111111111111',
    cardToken: 'card-A', customerId: 'cust-1', amount: 100, currency: 'USD',
    ip: '1.2.3.4', country: 'US', deviceFingerprint: 'fp-1',
    createdAt: '2026-06-01T00:00:00.000Z', ...over,
  });

  it('scores, returns 200, and persists', async () => {
    const res = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    expect(res.body.decision).toBe('approve');
    expect(res.body.score).toBe(100);
    expect(Array.isArray(res.body.triggeredRules)).toBe(true);
    expect(typeof res.body.evaluatedAt).toBe('string');
  });

  it('rejects an invalid payload with 400', async () => {
    await request(app.getHttpServer()).post('/score').send(body({ transactionId: 'not-a-uuid' })).expect(400);
  });

  it('is idempotent on duplicate transactionId', async () => {
    const a = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    const b = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    expect(b.body).toEqual(a.body);
  });

  it('lists transactions with cursor pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).post('/score')
        .send(body({ transactionId: `0000000${i}-0000-0000-0000-000000000000`,
                     createdAt: new Date(Date.parse('2026-06-01T00:00:00.000Z') + i).toISOString() }))
        .expect(200);
    }
    const p1 = await request(app.getHttpServer()).get('/transactions?limit=2').expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await request(app.getHttpServer()).get(`/transactions?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm test -- test/score.e2e-spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add test/score.e2e-spec.ts
git commit -m "test: add end-to-end score and listing tests"
```

---

## Task 14: k6 load test (500 TPS)

**Files:**
- Create: `k6/score-load.js`

- [ ] **Step 1: Create the k6 script (`k6/score-load.js`)**

```js
import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  scenarios: {
    score: {
      executor: 'constant-arrival-rate',
      rate: 500, timeUnit: '1s', duration: '5m',
      preAllocatedVUs: 100, maxVUs: 400,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(99)<50'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const r = Math.random();
  // ~10% same-card burst (velocity), rest unique
  const cardToken = r < 0.1 ? 'hot-card' : `card-${uuidv4()}`;
  const payload = JSON.stringify({
    transactionId: uuidv4(),
    cardToken,
    customerId: `cust-${Math.floor(Math.random() * 10000)}`,
    amount: Math.round(Math.random() * 1000 * 100) / 100,
    currency: 'USD',
    ip: '1.2.3.4',
    country: Math.random() < 0.05 ? 'DE' : 'US',
    deviceFingerprint: `fp-${Math.floor(Math.random() * 5000)}`,
    createdAt: new Date().toISOString(),
  });
  const res = http.post(`${BASE}/score`, payload, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'status 200': (x) => x.status === 200 });
}
```

- [ ] **Step 2: Document how to run it (manual verification, requires running stack)**

Run (local stack up via `docker-compose up -d`, app via `npm run start`):
```bash
k6 run k6/score-load.js
```
Expected: thresholds pass — `http_req_failed rate<0.001`, `p(99)<50ms`. Verify zero data loss:
`SELECT count(DISTINCT transaction_id) FROM transactions;` equals the count of unique txIds sent.

- [ ] **Step 3: Commit**

```bash
git add k6/score-load.js
git commit -m "test: add k6 load test for 500 TPS"
```

---

## Self-Review

**Spec coverage:**
- `POST /score` dedup → Task 9 (idempotency), Task 11 (orchestration), Task 13 (e2e). ✓
- velocity rule → Task 4. ✓
- shared-device rule → Task 5. ✓
- amount-spike (median, ≥2 prior floor) → Task 6. ✓
- new-geo (forever + PG cold-miss rebuild) → Task 7. ✓
- decision merge / score map → Task 8. ✓
- durable insert before 200, ON CONFLICT → Task 10, Task 11. ✓
- keyset cursor listing → Task 10, Task 13. ✓
- fail-closed on Redis down (503), 409 in-flight, 400 bad DTO → Task 11, Task 12, Task 13. ✓
- Postgres schema (BIGINT cursor PK, UNIQUE backstop) → Task 1. ✓
- Redis structures + Lua atomicity + idempotent members → Task 2, Tasks 4–7. ✓
- 500 TPS load test → Task 14. ✓

**Placeholder scan:** no TBD/TODO; all code blocks complete. ✓

**Type consistency:** `RuleResult{triggered,ruleName,severity}`, `ScoreOutcome{decision,score,triggeredRules,evaluatedAt}`, `slidingCount`/`slidingMembers`, `claim`/`complete`, `insert`/`list`/`distinctCountries`, `FraudRedis`, `RedisUnavailableError`/`InFlightError` — all used consistently across tasks. ✓
