import type { EvalMetrics, FixtureResult, RunResult } from './types.js';

/**
 * Aggregated metrics result with fixture counts.
 */
export interface AggregatedMetrics extends EvalMetrics {
  fixtureCount: number;
  totalExpectedBugs: number;
}

/**
 * Calculate precision, recall, and F1 from counts.
 */
export function calculateMetrics(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number
): EvalMetrics {
  // Precision = TP / (TP + FP)
  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 1; // If no predictions, precision is 1

  // Recall = TP / (TP + FN)
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 1; // If no expected bugs, recall is 1

  // F1 = 2 * (precision * recall) / (precision + recall)
  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

/**
 * Aggregate metrics from fixture results.
 */
export function aggregateFixtureMetrics(fixtures: FixtureResult[]): EvalMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const fixture of fixtures) {
    truePositives += fixture.found;
    falseNegatives += fixture.missed;
    falsePositives += fixture.spurious;
  }

  return calculateMetrics(truePositives, falsePositives, falseNegatives);
}

/**
 * Aggregate metrics across multiple runs.
 */
export function aggregateRunMetrics(runs: RunResult[]): AggregatedMetrics {
  if (runs.length === 0) {
    return {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      f1: 0,
      fixtureCount: 0,
      totalExpectedBugs: 0,
    };
  }

  // Sum metrics across all runs
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const run of runs) {
    truePositives += run.metrics.truePositives;
    falsePositives += run.metrics.falsePositives;
    falseNegatives += run.metrics.falseNegatives;
  }

  const metrics = calculateMetrics(truePositives, falsePositives, falseNegatives);

  // Get fixture count and total expected bugs from first run (same for all runs)
  const firstRun = runs[0];
  const fixtureCount = firstRun?.fixtures.length ?? 0;
  const totalExpectedBugs = firstRun?.fixtures.reduce((sum, f) => sum + f.expectedBugs, 0) ?? 0;

  return {
    ...metrics,
    fixtureCount,
    totalExpectedBugs,
  };
}
