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
  const rawRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  // Wait for the client to be ready before proceeding (avoids race on container start).
  // Reject immediately on error so the test fails fast instead of hanging until timeout.
  await new Promise<void>((resolve, reject) => {
    rawRedis.once('ready', resolve);
    rawRedis.once('error', reject);
  });
  const redis = defineFraudCommands(rawRedis);
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
