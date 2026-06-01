import { Decision, TransactionListItem, TransactionListPage } from '../types';

const DECISIONS: Decision[] = ['approve', 'approve', 'approve', 'review', 'decline'];
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'BR', 'JP', 'NG', 'IN'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const RULES_BY_DECISION: Record<Decision, string[]> = {
  approve: [],
  review: ['new_geo'],
  decline: ['velocity_card_1m'],
};
const SCORE_BY_DECISION: Record<Decision, number> = { approve: 100, review: 50, decline: 0 };

// Deterministic pseudo-random so the dataset is stable across reloads.
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

function buildRows(count: number): TransactionListItem[] {
  const rand = rng(42);
  const rows: TransactionListItem[] = [];
  const base = Date.UTC(2026, 5, 1, 0, 0, 0); // 2026-06-01T00:00:00Z
  for (let i = 1; i <= count; i++) {
    const decision = DECISIONS[Math.floor(rand() * DECISIONS.length)];
    const createdAt = new Date(base + i * 37_000).toISOString();
    rows.push({
      id: String(i), // monotonic ascending
      transactionId: `${pad(i)}-1111-1111-1111-111111111111`,
      cardToken: `card_${pad(Math.floor(rand() * 50))}`,
      customerId: `cust_${pad(Math.floor(rand() * 80))}`,
      amount: Math.round(rand() * 200000) / 100,
      currency: CURRENCIES[Math.floor(rand() * CURRENCIES.length)],
      ip: `${Math.floor(rand() * 255)}.0.0.${Math.floor(rand() * 255)}`,
      country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)],
      deviceFingerprint: `fp_${pad(Math.floor(rand() * 60))}`,
      createdAt,
      decision,
      score: SCORE_BY_DECISION[decision],
      triggeredRules: RULES_BY_DECISION[decision],
      evaluatedAt: createdAt,
    });
  }
  return rows;
}

export const MOCK_ROWS: TransactionListItem[] = buildRows(200);

// Pure keyset slice that mirrors the backend SQL:
//   WHERE id < cursor ORDER BY id DESC LIMIT limit (+1 to detect next).
export function slicePage(
  rows: TransactionListItem[],
  limit: number,
  cursor: number | undefined,
): TransactionListPage {
  const desc = [...rows].sort((a, b) => Number(b.id) - Number(a.id));
  const filtered = cursor === undefined ? desc : desc.filter((r) => Number(r.id) < cursor);
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextCursor = hasMore && page.length > 0 ? Number(page[page.length - 1].id) : null;
  return { items: page, nextCursor };
}
