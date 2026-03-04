import { describe, it, expect } from 'vitest';
import {
  FindingClusterSchema,
  RuleProposalSchema,
  BacktestResultSchema,
  RulesPipelineResultSchema,
} from './types.js';

describe('FindingClusterSchema', () => {
  it('validates a complete cluster', () => {
    const result = FindingClusterSchema.safeParse({
      id: 'abc123',
      pattern: 'bare except',
      severity: 'medium',
      skills: ['security'],
      runCount: 3,
      titles: ['Bare except clause'],
      descriptions: ['Do not use bare except'],
      paths: ['src/auth.py'],
      codeExamples: [],
      classification: 'lint-catchable',
      classificationReasoning: 'Syntactic pattern',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid classification', () => {
    const result = FindingClusterSchema.safeParse({
      id: 'abc123',
      pattern: 'test',
      severity: 'medium',
      skills: [],
      runCount: 1,
      titles: [],
      descriptions: [],
      paths: [],
      codeExamples: [],
      classification: 'invalid',
      classificationReasoning: 'test',
    });
    expect(result.success).toBe(false);
  });
});

describe('RuleProposalSchema', () => {
  it('validates enable-rule proposal', () => {
    const result = RuleProposalSchema.safeParse({
      clusterId: 'c1',
      linter: 'flake8',
      type: 'enable-rule',
      ruleCode: 'E722',
      selectValue: 'E722',
      rationale: 'Catches bare except',
      uncertainties: ['May have false positives'],
      adversarialVerdict: 'pass',
      adversarialIssues: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates no-viable-rule proposal', () => {
    const result = RuleProposalSchema.safeParse({
      clusterId: 'c1',
      linter: 'flake8',
      type: 'no-viable-rule',
      rationale: 'Requires semantic understanding',
      uncertainties: [],
      adversarialVerdict: 'pass',
      adversarialIssues: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('BacktestResultSchema', () => {
  it('validates a complete backtest result', () => {
    const result = BacktestResultSchema.safeParse({
      clusterId: 'c1',
      ruleCode: 'E722',
      linter: 'flake8',
      ruleRecognized: true,
      totalHits: 5,
      truePositives: 2,
      newHits: 3,
      sampleHits: [
        { path: 'src/auth.py', line: 10, message: 'bare except', isOriginalFinding: true },
      ],
      recommendation: 'adopt',
      recommendationReason: 'Fires on original locations',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid recommendation', () => {
    const result = BacktestResultSchema.safeParse({
      clusterId: 'c1',
      ruleCode: 'E722',
      linter: 'flake8',
      ruleRecognized: true,
      totalHits: 5,
      truePositives: 2,
      newHits: 3,
      sampleHits: [],
      recommendation: 'maybe',
      recommendationReason: 'test',
    });
    expect(result.success).toBe(false);
  });
});

describe('RulesPipelineResultSchema', () => {
  it('validates a minimal pipeline result', () => {
    const result = RulesPipelineResultSchema.safeParse({
      timestamp: '2026-02-25T00:00:00.000Z',
      durationMs: 1000,
      clusters: [],
      proposals: [],
      backtests: [],
      options: {},
    });
    expect(result.success).toBe(true);
  });
});
