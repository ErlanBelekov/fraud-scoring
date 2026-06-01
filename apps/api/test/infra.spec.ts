import { startInfra, TestInfra } from './setup-containers';

describe('infra', () => {
  let infra: TestInfra;
  beforeAll(async () => { infra = await startInfra(); });
  afterAll(async () => { await infra.stop(); });

  it('postgres has transactions table', async () => {
    const r = await infra.pg.query("SELECT to_regclass('transactions') AS t");
    expect(r.rows[0].t).toBe('transactions');
  });

  it('redis responds to ping', async () => {
    expect(await infra.redis.ping()).toBe('PONG');
  });
});
