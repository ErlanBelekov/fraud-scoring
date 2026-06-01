// Local copy of the @fraud/shared wire contract. When packages/shared exists,
// replace these with: export * from '@fraud/shared';
export type Decision = 'approve' | 'review' | 'decline';

export interface TransactionListItem {
  id: string;
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip: string | null;
  country: string;
  deviceFingerprint: string | null;
  createdAt: string; // ISO-8601
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextCursor: number | null;
}

export interface ListParams {
  limit: number;
  cursor?: number;
}
