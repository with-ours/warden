import { describe, it, expect } from 'vitest';
import { backtest } from './backtest.js';
import type { FindingCluster, RuleProposal } from './types.js';

describe('backtest', () => {
  const makeCluster = (overrides: Partial<FindingCluster> = {}): FindingCluster => ({
    id: 'c1',
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
    ...overrides,
  });

  it('returns empty results when no viable proposals', () => {
    const proposals: RuleProposal[] = [{
      clusterId: 'c1',
      linter: 'flake8',
      type: 'no-viable-rule',
      rationale: 'No rule exists',
      uncertainties: [],
      adversarialVerdict: 'pass',
      adversarialIssues: [],
    }];

    const { results } = backtest(proposals, [makeCluster()], '/nonexistent');
    expect(results).toHaveLength(0);
  });

  it('returns empty results when all proposals failed adversarial check', () => {
    const proposals: RuleProposal[] = [{
      clusterId: 'c1',
      linter: 'flake8',
      type: 'enable-rule',
      ruleCode: 'E722',
      selectValue: 'E722',
      rationale: 'Catches bare except',
      uncertainties: [],
      adversarialVerdict: 'fail',
      adversarialIssues: ['Wrong rule'],
    }];

    const { results } = backtest(proposals, [makeCluster()], '/nonexistent');
    expect(results).toHaveLength(0);
  });

  it('rejects when flake8 is not found', () => {
    const proposals: RuleProposal[] = [{
      clusterId: 'c1',
      linter: 'flake8',
      type: 'enable-rule',
      ruleCode: 'E722',
      selectValue: 'E722',
      rationale: 'Catches bare except',
      uncertainties: [],
      adversarialVerdict: 'pass',
      adversarialIssues: [],
    }];

    const { results } = backtest(proposals, [makeCluster()], '/nonexistent/path/to/repo');
    expect(results).toHaveLength(1);
    expect(results[0]?.recommendation).toBe('reject');
    expect(results[0]?.ruleRecognized).toBe(false);
  });
});
