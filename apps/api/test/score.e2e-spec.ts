import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { startInfra, TestInfra } from './setup-containers';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, PG_POOL, REDIS } from '../src/config/config.module';
import { Pool } from 'pg';
import { FraudRedis } from '../src/infra/redis.provider';

describe('POST /score & GET /transactions (e2e)', () => {
  let infra: TestInfra;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startInfra();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ pgUrl: infra.pgUrl, redisUrl: infra.redisUrl })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    // Close the app's own pool + redis (from providers) before stopping containers,
    // otherwise the open connections throw "terminating connection" at teardown.
    await app.get<Pool>(PG_POOL).end();
    app.get<FraudRedis>(REDIS).disconnect();
    await app.close();
    await infra.stop();
  });
  beforeEach(async () => { await infra.redis.flushall(); await infra.pg.query('TRUNCATE transactions'); });

  const body = (over = {}) => ({
    transactionId: '11111111-1111-4111-8111-111111111111',
    cardToken: 'card-A', customerId: 'cust-1', amount: 100, currency: 'USD',
    ip: '1.2.3.4', country: 'US', deviceFingerprint: 'fp-1',
    createdAt: '2026-06-01T00:00:00.000Z', ...over,
  });

  it('scores, returns 200, and persists', async () => {
    const res = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    expect(res.body.decision).toBe('approve');
    expect(res.body.score).toBe(100);
    expect(Array.isArray(res.body.triggeredRules)).toBe(true);
    expect(typeof res.body.evaluatedAt).toBe('string');
  });

  it('rejects an invalid payload with 400', async () => {
    await request(app.getHttpServer()).post('/score').send(body({ transactionId: 'not-a-uuid' })).expect(400);
  });

  it('is idempotent on duplicate transactionId', async () => {
    const a = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    const b = await request(app.getHttpServer()).post('/score').send(body()).expect(200);
    expect(b.body).toEqual(a.body);
  });

  it('lists transactions with cursor pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).post('/score')
        .send(body({ transactionId: `0000000${i}-0000-4000-8000-000000000000`,
                     createdAt: new Date(Date.parse('2026-06-01T00:00:00.000Z') + i).toISOString() }))
        .expect(200);
    }
    const p1 = await request(app.getHttpServer()).get('/transactions?limit=2').expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await request(app.getHttpServer()).get(`/transactions?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
  });
});
