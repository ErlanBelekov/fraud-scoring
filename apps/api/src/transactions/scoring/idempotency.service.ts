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
