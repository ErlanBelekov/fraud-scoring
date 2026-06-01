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
