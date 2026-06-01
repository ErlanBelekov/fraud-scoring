import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { AmountSpikeRule } from './amount-spike.rule';
import { ScoringContext } from '../../transaction.types';

const ctx = (txId: string, amount: number, createdAtMs: number): ScoringContext => ({
  transactionId: txId, cardToken: 'c', customerId: 'cust-1', amount,
  currency: 'USD', country: 'US', createdAtMs,
});

describe('AmountSpikeRule', () => {
  let infra: TestInfra;
  let rule: AmountSpikeRule;
  beforeAll(async () => { infra = await startInfra(); rule = new AmountSpikeRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger with fewer than 2 prior transactions', async () => {
    const r1 = await rule.evaluate(ctx('t1', 10, 1_000_000));
    const r2 = await rule.evaluate(ctx('t2', 10_000, 1_000_001));
    expect(r1.triggered).toBe(false);
    expect(r2.triggered).toBe(false);
  });

  it('triggers review when amount > 10x median of prior txns', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002)); // prior median = 20
    const res = await rule.evaluate(ctx('t4', 201, 1_000_003)); // 201 > 10*20
    expect(res.triggered).toBe(true);
    expect(res.severity).toBe('review');
    expect(res.ruleName).toBe('amount_spike');
  });

  it('does not trigger when amount is within 10x median', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002)); // prior median = 20
    const res = await rule.evaluate(ctx('t4', 199, 1_000_003)); // 199 < 200
    expect(res.triggered).toBe(false);
  });

  it('is idempotent on replay (same txId|amount member)', async () => {
    await rule.evaluate(ctx('t1', 10, 1_000_000));
    await rule.evaluate(ctx('t2', 20, 1_000_001));
    await rule.evaluate(ctx('t3', 30, 1_000_002));
    const a = await rule.evaluate(ctx('t4', 201, 1_000_003));
    const b = await rule.evaluate(ctx('t4', 201, 1_000_003));
    expect(a.triggered).toBe(true);
    expect(b.triggered).toBe(true);
  });
});
