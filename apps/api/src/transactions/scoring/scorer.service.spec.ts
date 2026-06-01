import { ScorerService } from './scorer.service';
import { Rule } from './rules/rule.interface';
import { RuleResult, ScoringContext } from '../transaction.types';

const fakeRule = (r: RuleResult): Rule => ({ evaluate: async () => r });
const ctx = {} as ScoringContext;

describe('ScorerService', () => {
  it('approves (score 100) when no rule triggers', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: false, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: false, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('approve');
    expect(out.score).toBe(100);
    expect(out.triggeredRules).toEqual([]);
  });

  it('reviews (score 50) when only a review rule triggers', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: false, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: true, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('review');
    expect(out.score).toBe(50);
    expect(out.triggeredRules).toEqual(['new_geo']);
  });

  it('declines (score 0) when a decline rule triggers alongside a review rule', async () => {
    const svc = new ScorerService([
      fakeRule({ triggered: true, ruleName: 'velocity_card_1m', severity: 'decline' }),
      fakeRule({ triggered: true, ruleName: 'new_geo', severity: 'review' }),
    ]);
    const out = await svc.score(ctx);
    expect(out.decision).toBe('decline');
    expect(out.score).toBe(0);
    expect(out.triggeredRules).toEqual(['velocity_card_1m', 'new_geo']);
  });

  it('includes an ISO-8601 evaluatedAt timestamp', async () => {
    const svc = new ScorerService([]);
    const out = await svc.score(ctx);
    expect(() => new Date(out.evaluatedAt).toISOString()).not.toThrow();
  });
});
