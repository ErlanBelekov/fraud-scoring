import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config/config.module';
import { Decision, StoredTransaction } from './transaction.types';

export interface InsertInput {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string | null;
  country: string;
  deviceFingerprint?: string | null;
  createdAt: string;
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string;
}

export interface ListPage {
  items: StoredTransaction[];
  nextCursor: number | null;
}

const COLUMNS = `
  id, transaction_id, card_token, customer_id, amount, currency, ip, country,
  device_fingerprint, created_at, decision, score, triggered_rules, evaluated_at`;

@Injectable()
export class TransactionsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async distinctCountries(customerId: string): Promise<string[]> {
    const r = await this.pool.query<{ country: string }>(
      'SELECT DISTINCT country FROM transactions WHERE customer_id = $1',
      [customerId],
    );
    return r.rows.map((x) => x.country);
  }

  async insert(input: InsertInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO transactions
        (transaction_id, card_token, customer_id, amount, currency, ip, country,
         device_fingerprint, created_at, decision, score, triggered_rules, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        input.transactionId, input.cardToken, input.customerId, input.amount, input.currency,
        input.ip ?? null, input.country, input.deviceFingerprint ?? null, input.createdAt,
        input.decision, input.score, input.triggeredRules, input.evaluatedAt,
      ],
    );
  }

  async list(limit: number, cursor?: number): Promise<ListPage> {
    const params: unknown[] = [];
    let where = '';
    if (cursor !== undefined) { params.push(cursor); where = `WHERE id < $1`; }
    params.push(limit + 1);
    const r = await this.pool.query(
      `SELECT ${COLUMNS} FROM transactions ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const rows = r.rows.map(this.map);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? Number(items[items.length - 1].id) : null;
    return { items, nextCursor };
  }

  private map = (row: any): StoredTransaction => ({
    id: String(row.id),
    transactionId: row.transaction_id,
    cardToken: row.card_token,
    customerId: row.customer_id,
    amount: Number(row.amount),
    currency: row.currency.trim(),
    ip: row.ip,
    country: row.country,
    deviceFingerprint: row.device_fingerprint,
    createdAt: new Date(row.created_at).toISOString(),
    decision: row.decision,
    score: row.score,
    triggeredRules: row.triggered_rules,
    evaluatedAt: new Date(row.evaluated_at).toISOString(),
  });
}
