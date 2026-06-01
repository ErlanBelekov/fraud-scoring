import { startInfra, TestInfra } from '../../../test/setup-containers';
import { ScoreService, RedisUnavailableError } from './score.service';
import { ScorerService } from './scorer.service';
import { IdempotencyService } from './idempotency.service';
import { TransactionsRepository } from '../transactions.repository';
import { VelocityRule } from './rules/velocity.rule';
import { SharedDeviceRule } from './rules/shared-device.rule';
import { AmountSpikeRule } from './rules/amount-spike.rule';
import { NewGeoRule } from './rules/new-geo.rule';
import { ScoreRequestDto } from '../dto/score-request.dto';

const req = (over: Partial<ScoreRequestDto> = {}): ScoreRequestDto => ({
  transactionId: '11111111-1111-1111-1111-111111111111',
  cardToken: 'card-A', customerId: 'cust-1', amount: 100, currency: 'USD',
  ip: '1.2.3.4', country: 'US', deviceFingerprint: 'fp-1',
  createdAt: '2026-06-01T00:00:00.000Z', ...over,
});

function build(infra: TestInfra): ScoreService {
  const repo = new TransactionsRepository(infra.pg as any);
  const scorer = new ScorerService([
    new VelocityRule(infra.redis),
    new SharedDeviceRule(infra.redis),
    new AmountSpikeRule(infra.redis),
    new NewGeoRule(infra.redis, repo),
  ]);
  return new ScoreService(new IdempotencyService(infra.redis), scorer, repo);
}

describe('ScoreService', () => {
  let infra: TestInfra;
  let svc: ScoreService;
  beforeAll(async () => { infra = await startInfra(); svc = build(infra); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  it('approves a clean transaction and persists it', async () => {
    const out = await svc.handle(req());
    expect(out.decision).toBe('approve');
    expect(out.score).toBe(100);
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('returns the stored outcome on duplicate without a second insert', async () => {
    const first = await svc.handle(req());
    const second = await svc.handle(req());
    expect(second).toEqual(first);
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('declines on card velocity > 5 in a minute', async () => {
    let out;
    for (let i = 0; i < 6; i++) {
      out = await svc.handle(req({
        transactionId: `00000000-0000-0000-0000-00000000000${i}`,
        createdAt: new Date(Date.parse('2026-06-01T00:00:00.000Z') + i).toISOString(),
      }));
    }
    expect(out!.decision).toBe('decline');
    expect(out!.triggeredRules).toContain('velocity_card_1m');
  });

  it('throws RedisUnavailableError when Redis is down (fail closed)', async () => {
    const brokenRedis = {
      ...infra.redis,
      set: async () => { throw new Error('connection refused'); },
    } as any;
    const broken = build({ ...infra, redis: brokenRedis });
    await expect(broken.handle(req())).rejects.toBeInstanceOf(RedisUnavailableError);
  });
});
