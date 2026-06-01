// The wire contract shared by the API and the frontend. Keep framework-free.
export type Decision = 'approve' | 'review' | 'decline';

export interface ScoreRequest {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string;
  country: string;
  deviceFingerprint?: string;
  createdAt: string; // ISO-8601
}

export interface ScoreResponse {
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface TransactionListItem extends ScoreResponse {
  id: string;
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip: string | null;
  country: string;
  deviceFingerprint: string | null;
  createdAt: string;
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextCursor: number | null;
}
