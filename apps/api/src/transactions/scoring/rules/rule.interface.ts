import { ScoringContext, RuleResult } from '../../transaction.types';

export interface Rule {
  evaluate(ctx: ScoringContext): Promise<RuleResult>;
}
