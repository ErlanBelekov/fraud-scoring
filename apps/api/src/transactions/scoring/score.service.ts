import { Injectable, Logger } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { ScorerService } from './scorer.service';
import { TransactionsRepository } from '../transactions.repository';
import { ScoreRequestDto } from '../dto/score-request.dto';
import { ScoreOutcome, ScoringContext } from '../transaction.types';

export class RedisUnavailableError extends Error {}
export class InFlightError extends Error {}

@Injectable()
export class ScoreService {
  private readonly log = new Logger(ScoreService.name);

  constructor(
    private readonly idem: IdempotencyService,
    private readonly scorer: ScorerService,
    private readonly repo: TransactionsRepository,
  ) {}

  async handle(req: ScoreRequestDto): Promise<ScoreOutcome> {
    let claim;
    try {
      claim = await this.idem.claim(req.transactionId);
    } catch (e) {
      throw new RedisUnavailableError((e as Error).message);
    }
    if (claim === 'pending') throw new InFlightError(req.transactionId);
    if (typeof claim === 'object') return claim.outcome; // duplicate replay

    const ctx: ScoringContext = {
      transactionId: req.transactionId,
      cardToken: req.cardToken,
      customerId: req.customerId,
      amount: req.amount,
      currency: req.currency,
      ip: req.ip,
      country: req.country,
      deviceFingerprint: req.deviceFingerprint,
      createdAtMs: Date.parse(req.createdAt),
    };

    let outcome: ScoreOutcome;
    try {
      outcome = await this.scorer.score(ctx);
    } catch (e) {
      throw new RedisUnavailableError((e as Error).message);
    }

    // Durability point: persist BEFORE marking the idempotency record complete
    // and before returning to the caller.
    await this.repo.insert({
      transactionId: req.transactionId,
      cardToken: req.cardToken,
      customerId: req.customerId,
      amount: req.amount,
      currency: req.currency,
      ip: req.ip,
      country: req.country,
      deviceFingerprint: req.deviceFingerprint,
      createdAt: req.createdAt,
      decision: outcome.decision,
      score: outcome.score,
      triggeredRules: outcome.triggeredRules,
      evaluatedAt: outcome.evaluatedAt,
    });

    await this.idem.complete(req.transactionId, outcome);
    return outcome;
  }
}
