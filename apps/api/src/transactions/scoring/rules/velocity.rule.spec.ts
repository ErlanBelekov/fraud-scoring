import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { VelocityRule } from './velocity.rule';
import { ScoringContext } from '../../transaction.types';

const baseCtx = (over: Partial<ScoringContext>): ScoringContext => ({
  transactionId: '', cardToken: 'card-A', customerId: 'cust-1', amount: 10,
  currency: 'USD', country: 'US', createdAtMs: 1_000_000, ...over,
});

describe('VelocityRule', () => {
  let infra: TestInfra;
  let rule: VelocityRule;
  beforeAll(async () => { infra = await startInfra(); rule = new VelocityRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger at 5 transactions in the window', async () => {
    let res;
    for (let i = 0; i < 5; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    expect(res!.triggered).toBe(false);
  });

  it('triggers decline at the 6th transaction within 60s', async () => {
    let res;
    for (let i = 0; i < 6; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    expect(res!.triggered).toBe(true);
    expect(res!.severity).toBe('decline');
    expect(res!.ruleName).toBe('velocity_card_1m');
  });

  it('is idempotent: replaying the same txId does not inflate the count', async () => {
    for (let i = 0; i < 5; i++) {
      await rule.evaluate(baseCtx({ transactionId: `t${i}`, createdAtMs: 1_000_000 + i }));
    }
    let res;
    for (let k = 0; k < 4; k++) {
      res = await rule.evaluate(baseCtx({ transactionId: 't0', createdAtMs: 1_000_000 }));
    }
    expect(res!.triggered).toBe(false);
  });

  it('evicts transactions older than 60s', async () => {
    await rule.evaluate(baseCtx({ transactionId: 'old', createdAtMs: 1_000_000 }));
    let res;
    for (let i = 0; i < 5; i++) {
      res = await rule.evaluate(baseCtx({ transactionId: `n${i}`, createdAtMs: 1_000_000 + 61_000 + i }));
    }
    expect(res!.triggered).toBe(false);
  });
});
