import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { SharedDeviceRule } from './shared-device.rule';
import { ScoringContext } from '../../transaction.types';

const ctx = (customerId: string, createdAtMs: number): ScoringContext => ({
  transactionId: `${customerId}-${createdAtMs}`, cardToken: 'c', customerId, amount: 10,
  currency: 'USD', country: 'US', deviceFingerprint: 'fp-1', createdAtMs,
});

describe('SharedDeviceRule', () => {
  let infra: TestInfra;
  let rule: SharedDeviceRule;
  beforeAll(async () => { infra = await startInfra(); rule = new SharedDeviceRule(infra.redis); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); });

  it('does not trigger for 3 distinct customers on one device', async () => {
    let res;
    for (const c of ['a', 'b', 'c']) res = await rule.evaluate(ctx(c, 1_000_000));
    expect(res!.triggered).toBe(false);
  });

  it('triggers decline at the 4th distinct customer within 24h', async () => {
    let res;
    for (const c of ['a', 'b', 'c', 'd']) res = await rule.evaluate(ctx(c, 1_000_000));
    expect(res!.triggered).toBe(true);
    expect(res!.severity).toBe('decline');
    expect(res!.ruleName).toBe('shared_device');
  });

  it('counts distinct customers, not transactions (same customer repeats)', async () => {
    let res;
    for (let i = 0; i < 10; i++) res = await rule.evaluate(ctx('a', 1_000_000 + i));
    expect(res!.triggered).toBe(false);
  });

  it('does not trigger when deviceFingerprint is absent', async () => {
    const res = await rule.evaluate({ ...ctx('a', 1_000_000), deviceFingerprint: undefined });
    expect(res.triggered).toBe(false);
  });
});
