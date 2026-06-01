import { startInfra, TestInfra } from '../../../test/setup-containers';
import { IdempotencyService } from './idempotency.service';
import { ScoreOutcome } from '../transaction.types';

const outcome: ScoreOutcome = {
  decision: 'review', score: 50, triggeredRules: ['new_geo'], evaluatedAt: '2026-06-01T00:00:00.000Z',
};

describe('IdempotencyService', () => {
  let infra: TestInfra;
  let svc: IdempotencyService;
  beforeAll(async () => { infra = await startInfra(); svc = new IdempotencyService(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('claims a fresh transactionId', async () => {
    expect(await svc.claim('tx-1')).toBe('claimed');
  });

  it('returns the stored outcome on replay after completion', async () => {
    await svc.claim('tx-1');
    await svc.complete('tx-1', outcome);
    const replay = await svc.claim('tx-1');
    expect(replay).toEqual({ status: 'duplicate', outcome });
  });

  it('reports a pending claim when still in-flight', async () => {
    await svc.claim('tx-1');
    expect(await svc.claim('tx-1')).toBe('pending');
  });
});
