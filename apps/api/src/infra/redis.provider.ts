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
