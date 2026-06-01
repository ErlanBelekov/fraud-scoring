import { Pool } from 'pg';
import { defineFraudCommands, FraudRedis } from '../src/infra/redis.provider';
import Redis from 'ioredis';

export interface TestInfra {
  pg: Pool;
  redis: FraudRedis;
  pgUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

// Connects to the shared postgres + redis pair booted once by test/global-setup.ts.
// Each spec gets its own client handles (cheap) but no new containers. Isolation
// between tests is via flushall + TRUNCATE in the specs' beforeEach.
export async function startInfra(): Promise<TestInfra> {
  const pgUrl = process.env.TEST_PG_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!pgUrl || !redisUrl) {
    throw new Error('TEST_PG_URL / TEST_REDIS_URL not set — is global-setup.ts wired in jest.config?');
  }

  const pg = new Pool({ connectionString: pgUrl });
  const rawRedis = new Redis(redisUrl);
  // Wait for the client to be ready, with a timeout guard. Transient connect
  // errors during warmup are ignored — ioredis reconnects and then emits 'ready'.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('redis ready timeout')), 15_000);
    rawRedis.once('ready', () => { clearTimeout(timer); resolve(); });
  });
  const redis = defineFraudCommands(rawRedis);

  return {
    pg, redis, pgUrl, redisUrl,
    stop: async () => {
      await pg.end();
      redis.disconnect();
    },
  };
}
