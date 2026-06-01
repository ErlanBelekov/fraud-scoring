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
