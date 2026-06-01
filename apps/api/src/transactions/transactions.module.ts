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
