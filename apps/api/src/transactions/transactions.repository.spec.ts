import { startInfra, TestInfra } from '../../test/setup-containers';
import { TransactionsRepository } from './transactions.repository';

const row = (txId: string, country = 'US') => ({
  transactionId: txId, cardToken: 'c', customerId: 'cust-1', amount: 12.5, currency: 'USD',
  ip: '1.2.3.4', country, deviceFingerprint: 'fp', createdAt: '2026-06-01T00:00:00.000Z',
  decision: 'approve' as const, score: 100, triggeredRules: [], evaluatedAt: '2026-06-01T00:00:01.000Z',
});

describe('TransactionsRepository', () => {
  let infra: TestInfra;
  let repo: TransactionsRepository;
  beforeAll(async () => { infra = await startInfra(); repo = new TransactionsRepository(infra.pg as any); });
  afterAll(async () => { await infra.stop(); });
  beforeEach(async () => { await infra.pg.query('TRUNCATE transactions'); });

  it('inserts a transaction', async () => {
    await repo.insert(row('11111111-1111-1111-1111-111111111111'));
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('is idempotent: ON CONFLICT DO NOTHING on duplicate transaction_id', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    await repo.insert(row(id));
    await repo.insert(row(id));
    const r = await infra.pg.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(1);
  });

  it('lists newest first with keyset pagination', async () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
    ];
    for (const id of ids) await repo.insert(row(id));

    const page1 = await repo.list(2, undefined);
    expect(page1.items.length).toBe(2);
    expect(page1.items[0].transactionId).toBe(ids[2]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.list(2, page1.nextCursor!);
    expect(page2.items.length).toBe(1);
    expect(page2.items[0].transactionId).toBe(ids[0]);
    expect(page2.nextCursor).toBeNull();
  });
});
