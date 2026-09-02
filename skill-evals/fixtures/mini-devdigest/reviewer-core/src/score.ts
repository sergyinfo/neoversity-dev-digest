import type { Finding } from './contracts.js';

const SEVERITY_WEIGHT = { high: 25, medium: 10, low: 3 };

export function scoreFromSurvivors(survived: Finding[]): number {
  const penalty = survived.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - penalty);
}
