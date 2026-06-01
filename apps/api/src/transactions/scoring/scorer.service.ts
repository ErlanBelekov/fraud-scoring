import { Inject, Injectable } from '@nestjs/common';
import { Rule } from './rules/rule.interface';
import {
  ScoringContext, ScoreOutcome, Decision, SCORE_BY_DECISION, DECISION_SEVERITY,
} from '../transaction.types';

export const RULES = 'RULES';

@Injectable()
export class ScorerService {
  constructor(@Inject(RULES) private readonly rules: Rule[]) {}

  async score(ctx: ScoringContext): Promise<ScoreOutcome> {
    const results = await Promise.all(this.rules.map((r) => r.evaluate(ctx)));
    const triggered = results.filter((r) => r.triggered);
    const triggeredRules = triggered.map((r) => r.ruleName);

    // Worst severity wins. Default to approve when nothing fires.
    let decision: Decision = 'approve';
    for (const r of triggered) {
      if (DECISION_SEVERITY.indexOf(r.severity) < DECISION_SEVERITY.indexOf(decision)) {
        decision = r.severity;
      }
    }

    return {
      decision,
      score: SCORE_BY_DECISION[decision],
      triggeredRules,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
