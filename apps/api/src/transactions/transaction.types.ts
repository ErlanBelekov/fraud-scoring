import type { Decision } from '@fraud/shared';
export type { Decision };

export const SCORE_BY_DECISION: Record<Decision, number> = {
  decline: 0,
  review: 50,
  approve: 100,
};

// Severity ordering: lower index = worse. Used to merge rule outcomes.
export const DECISION_SEVERITY: Decision[] = ['decline', 'review', 'approve'];

export interface ScoringContext {
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip?: string;
  country: string;
  deviceFingerprint?: string;
  createdAtMs: number; // epoch ms parsed from payload.createdAt
}

export interface RuleResult {
  triggered: boolean;
  ruleName: string;
  // The decision this rule implies WHEN triggered.
  severity: Decision;
}

export interface ScoreOutcome {
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface StoredTransaction {
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
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string;
}
