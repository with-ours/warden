import { describe, it, expect } from 'vitest';
import {
  calculateMetrics,
  aggregateFixtureMetrics,
  aggregateRunMetrics,
} from './metrics.js';
import type { FixtureResult, RunResult } from './types.js';

describe('calculateMetrics', () => {
  it('calculates precision, recall, and F1', () => {
    // 8 TP, 2 FP, 2 FN
    const metrics = calculateMetrics(8, 2, 2);

    // Precision = 8 / (8 + 2) = 0.8
    expect(metrics.precision).toBeCloseTo(0.8);

    // Recall = 8 / (8 + 2) = 0.8
    expect(metrics.recall).toBeCloseTo(0.8);

    // F1 = 2 * (0.8 * 0.8) / (0.8 + 0.8) = 0.8
    expect(metrics.f1).toBeCloseTo(0.8);
  });

  it('handles perfect scores', () => {
    const metrics = calculateMetrics(10, 0, 0);

    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
  });

  it('handles no predictions', () => {
    const metrics = calculateMetrics(0, 0, 5);

    // No predictions made, precision is 1 (no false positives)
    expect(metrics.precision).toBe(1);
    // Missed all expected bugs
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
  });

  it('handles no expected bugs', () => {
    const metrics = calculateMetrics(0, 2, 0);

    // 2 false positives
    expect(metrics.precision).toBe(0);
    // No expected bugs to find, recall is 1
    expect(metrics.recall).toBe(1);
  });
});

describe('aggregateFixtureMetrics', () => {
  it('aggregates metrics from multiple fixtures', () => {
    const fixtures: FixtureResult[] = [
      {
        fixture: 'test1',
        skill: 'eval-test',
        description: 'Test 1',
        expectedBugs: 2,
        found: 2,
        missed: 0,
        spurious: 1,
        matchOutcomes: [],
        spuriousFindings: [],
        durationMs: 100,
      },
      {
        fixture: 'test2',
        skill: 'eval-test',
        description: 'Test 2',
        expectedBugs: 3,
        found: 2,
        missed: 1,
        spurious: 0,
        matchOutcomes: [],
        spuriousFindings: [],
        durationMs: 100,
      },
    ];

    const metrics = aggregateFixtureMetrics(fixtures);

    // TP = 2 + 2 = 4, FP = 1 + 0 = 1, FN = 0 + 1 = 1
    expect(metrics.truePositives).toBe(4);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(1);
  });
});

describe('aggregateRunMetrics', () => {
  it('aggregates metrics across runs', () => {
    const runs: RunResult[] = [
      {
        runNumber: 1,
        fixtures: [
          {
            fixture: 'test',
            skill: 'eval-test',
            description: 'Test',
            expectedBugs: 2,
            found: 2,
            missed: 0,
            spurious: 0,
            matchOutcomes: [],
            spuriousFindings: [],
            durationMs: 100,
          },
        ],
        metrics: { truePositives: 2, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1 },
        durationMs: 100,
      },
      {
        runNumber: 2,
        fixtures: [
          {
            fixture: 'test',
            skill: 'eval-test',
            description: 'Test',
            expectedBugs: 2,
            found: 1,
            missed: 1,
            spurious: 0,
            matchOutcomes: [],
            spuriousFindings: [],
            durationMs: 100,
          },
        ],
        metrics: { truePositives: 1, falsePositives: 0, falseNegatives: 1, precision: 1, recall: 0.5, f1: 0.667 },
        durationMs: 100,
      },
    ];

    const result = aggregateRunMetrics(runs);

    expect(result.fixtureCount).toBe(1);
    expect(result.totalExpectedBugs).toBe(2);
    expect(result.truePositives).toBe(3);
    expect(result.falseNegatives).toBe(1);
  });

  it('handles empty runs', () => {
    const result = aggregateRunMetrics([]);

    expect(result.fixtureCount).toBe(0);
    expect(result.totalExpectedBugs).toBe(0);
  });
});
