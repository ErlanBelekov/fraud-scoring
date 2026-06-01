import { startInfra, TestInfra } from '../../../../test/setup-containers';
import { NewGeoRule } from './new-geo.rule';
import { TransactionsRepository } from '../../transactions.repository';
import { ScoringContext } from '../../transaction.types';

const ctx = (country: string, amount: number): ScoringContext => ({
  transactionId: `${country}-${amount}`, cardToken: 'c', customerId: 'cust-1', amount,
  currency: 'USD', country, createdAtMs: 1_000_000,
});

describe('NewGeoRule', () => {
  let infra: TestInfra;
  let rule: NewGeoRule;
  beforeAll(async () => {
    infra = await startInfra();
    rule = new NewGeoRule(infra.redis, new TransactionsRepository(infra.pg as any));
  });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  it('triggers review for a new country with amount > 500', async () => {
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(true);
    expect(res.severity).toBe('review');
    expect(res.ruleName).toBe('new_geo');
  });

  it('does not trigger for a new country with amount <= 500', async () => {
    const res = await rule.evaluate(ctx('US', 500));
    expect(res.triggered).toBe(false);
  });

  it('does not trigger for an already-seen country', async () => {
    await rule.evaluate(ctx('US', 600));
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(false);
  });

  it('rebuilds the geo set from Postgres on a cold Redis miss', async () => {
    await infra.pg.query(
      `INSERT INTO transactions
       (transaction_id, card_token, customer_id, amount, currency, country, created_at, decision, score, evaluated_at)
       VALUES (gen_random_uuid(), 'c', 'cust-1', 10, 'USD', 'US', now(), 'approve', 100, now())`,
    );
    const res = await rule.evaluate(ctx('US', 600));
    expect(res.triggered).toBe(false);
  });
});
