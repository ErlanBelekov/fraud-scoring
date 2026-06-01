import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const RATE = Number(__ENV.RATE || 500);       // requests/sec
const DURATION = __ENV.DURATION || '5m';
const P99 = Number(__ENV.P99 || 50);          // ms

export const options = {
  scenarios: {
    score: {
      executor: 'constant-arrival-rate',
      rate: RATE, timeUnit: '1s', duration: DURATION,
      preAllocatedVUs: 100, maxVUs: 600,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: [`p(99)<${P99}`],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const r = Math.random();
  // ~10% same-card burst (velocity), rest unique
  const cardToken = r < 0.1 ? 'hot-card' : `card-${uuidv4()}`;
  const payload = JSON.stringify({
    transactionId: uuidv4(),
    cardToken,
    customerId: `cust-${Math.floor(Math.random() * 10000)}`,
    amount: Math.round(Math.random() * 1000 * 100) / 100,
    currency: 'USD',
    ip: '1.2.3.4',
    country: Math.random() < 0.05 ? 'DE' : 'US',
    deviceFingerprint: `fp-${Math.floor(Math.random() * 5000)}`,
    createdAt: new Date().toISOString(),
  });
  const res = http.post(`${BASE}/score`, payload, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'status 200': (x) => x.status === 200 });
}
