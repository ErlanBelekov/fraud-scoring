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
