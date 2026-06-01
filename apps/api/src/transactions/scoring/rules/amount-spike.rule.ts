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
