import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finding, UsageStats } from '../types/index.js';

const {
  startSpanMock,
  captureFindingStageMock,
  emitDedupMetricsMock,
  emitFixGateMetricsMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  startSpanMock: vi.fn(async (_options: unknown, callback: (span: unknown) => unknown) => callback({})),
  captureFindingStageMock: vi.fn(),
  emitDedupMetricsMock: vi.fn(),
  emitFixGateMetricsMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock('../sentry.js', () => ({
  Sentry: { startSpan: startSpanMock },
  captureFindingStage: captureFindingStageMock,
  emitDedupMetrics: emitDedupMetricsMock,
  emitFixGateMetrics: emitFixGateMetricsMock,
  logger: { info: loggerInfoMock },
}));

vi.mock('./extract.js', async () => {
  const actual = await vi.importActual('./extract.js');
  return {
    ...(actual as object),
    deduplicateFindings: vi.fn((findings: Finding[]) => findings.slice(0, 1)),
    mergeCrossLocationFindings: vi.fn(async (findings: Finding[]) => ({ findings })),
  };
});

vi.mock('./fix-quality.js', () => ({
  sanitizeFindingsSuggestedFixes: vi.fn(async (findings: Finding[]) => ({
    findings,
    stats: {
      checked: 0,
      strippedDeterministic: 0,
      strippedSemantic: 0,
      semanticUnavailable: 0,
    },
  })),
}));

import { deduplicateFindings, mergeCrossLocationFindings } from './extract.js';
import { sanitizeFindingsSuggestedFixes } from './fix-quality.js';
import { filterOutOfRangeFindings, finalizeSkillReport } from './analyze.js';

function makeFinding(id: string, title: string, startLine = 10): Finding {
  return {
    id,
    severity: 'medium',
    confidence: 'high',
    title,
    description: `${title} description`,
    location: { path: 'src/test.ts', startLine },
  };
}

function makeGeneralFinding(id = 'general'): Finding {
  return {
    id,
    severity: 'low',
    title: 'General finding',
    description: 'no location',
  };
}

describe('filterOutOfRangeFindings', () => {
  const hunkRange = { start: 10, end: 20 };

  it('preserves finding within hunk range', () => {
    const findings = [makeFinding('in-range', 'In range', 15)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  it('preserves findings at range boundaries', () => {
    const findings = [makeFinding('at-start', 'At start', 10), makeFinding('at-end', 'At end', 20)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it('drops finding below hunk start', () => {
    const findings = [makeFinding('below', 'Below', 5)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual([]);
    expect(dropped).toEqual(findings);
  });

  it('drops finding above hunk end', () => {
    const findings = [makeFinding('above', 'Above', 25)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual([]);
    expect(dropped).toEqual(findings);
  });

  it('preserves finding with no location', () => {
    const findings = [makeGeneralFinding()];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  it('filters mixed set correctly', () => {
    const inRange = makeFinding('in-range', 'In range', 15);
    const belowRange = makeFinding('below', 'Below', 3);
    const aboveRange = makeFinding('above', 'Above', 50);
    const general = makeGeneralFinding('general');

    const { filtered, dropped } = filterOutOfRangeFindings([inRange, belowRange, aboveRange, general], hunkRange);
    expect(filtered).toEqual([inRange, general]);
    expect(dropped).toEqual([belowRange, aboveRange]);
  });

  it('returns empty arrays for empty input', () => {
    const { filtered, dropped } = filterOutOfRangeFindings([], hunkRange);
    expect(filtered).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

describe('finalizeSkillReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits report stages from the shared finalization path', async () => {
    const findings = [makeFinding('A', 'First'), makeFinding('B', 'Second')];
    const usage: UsageStats = { inputTokens: 10, outputTokens: 5, costUSD: 0.01 };

    const report = await finalizeSkillReport({
      skillName: 'security-review',
      startTime: Date.now(),
      repoPath: '/repo',
      allFindings: findings,
      allUsage: [usage],
      allAuxiliaryUsage: [],
      files: [{ filename: 'src/test.ts', findingCount: 2, durationMs: 50, usage }],
    });

    expect(deduplicateFindings).toHaveBeenCalledWith(findings);
    expect(mergeCrossLocationFindings).toHaveBeenCalledWith([findings[0]], {
      apiKey: undefined,
      repoPath: '/repo',
      maxRetries: undefined,
    });
    expect(sanitizeFindingsSuggestedFixes).toHaveBeenCalledWith([findings[0]], {
      repoPath: '/repo',
      apiKey: undefined,
      maxRetries: undefined,
    });
    expect(captureFindingStageMock.mock.calls.map((call) => call[0])).toEqual([
      'report_deduped',
      'report_merged',
      'report_final',
    ]);
    expect(captureFindingStageMock).toHaveBeenNthCalledWith(1, 'report_deduped', [findings[0]], {
      skill: 'security-review',
    });
    expect(report.findings).toEqual([findings[0]]);
    expect(report.skill).toBe('security-review');
    expect(report.files).toHaveLength(1);
  });
});
