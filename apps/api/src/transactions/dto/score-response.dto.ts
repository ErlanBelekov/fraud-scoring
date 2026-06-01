import type { ScoreResponse, Decision } from '@fraud/shared';

export class ScoreResponseDto implements ScoreResponse {
  decision!: Decision;
  score!: number;
  triggeredRules!: string[];
  evaluatedAt!: string;
}
