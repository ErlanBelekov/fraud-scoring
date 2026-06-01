import { homedir } from 'os';
import { existsSync } from 'fs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import { runMigrations } from '../src/infra/postgres.provider';

// Configure Docker host for Colima before any container starts. globalSetup runs
// in the main process BEFORE jest's setupFiles, so the shim must live here too.
function configureDockerHost(): void {
  if (process.env.DOCKER_HOST) return;
  const colimaSocket = `${homedir()}/.colima/default/docker.sock`;
  if (existsSync(colimaSocket)) {
    process.env.DOCKER_HOST = `unix://${colimaSocket}`;
    process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
  }
}

// Boots ONE postgres + redis pair shared by every integration spec. URLs are
// exported via process.env (inherited by test workers); container handles are
// stashed on globalThis for teardown.
export default async function globalSetup(): Promise<void> {
  configureDockerHost();

  const pgC = await new PostgreSqlContainer('postgres:16').start();
  const redisC = await new RedisContainer('redis:7').start();

  const pgUrl = pgC.getConnectionUri();
  const redisUrl = redisC.getConnectionUrl();

  const pool = new Pool({ connectionString: pgUrl });
  await runMigrations(pool);
  await pool.end();

  process.env.TEST_PG_URL = pgUrl;
  process.env.TEST_REDIS_URL = redisUrl;
  (globalThis as any).__TEST_CONTAINERS__ = { pgC, redisC };
}
