import { describe, it, expect } from 'vitest';
import { filterOutOfRangeFindings, resolveToolPolicy } from './analyze.js';
import type { Finding } from '../types/index.js';
import type { SkillDefinition } from '../config/schema.js';

function makeFinding(startLine: number, id = `f-${startLine}`): Finding {
  return {
    id,
    severity: 'medium',
    confidence: 'high',
    title: `Finding at line ${startLine}`,
    description: 'test',
    location: { path: 'file.ts', startLine },
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
    const findings = [makeFinding(15)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  it('preserves findings at range boundaries', () => {
    const findings = [makeFinding(10, 'at-start'), makeFinding(20, 'at-end')];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it('drops finding below hunk start', () => {
    const findings = [makeFinding(5)];
    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual([]);
    expect(dropped).toEqual(findings);
  });

  it('drops finding above hunk end', () => {
    const findings = [makeFinding(25)];
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
    const inRange = makeFinding(15, 'in-range');
    const belowRange = makeFinding(3, 'below');
    const aboveRange = makeFinding(50, 'above');
    const general = makeGeneralFinding('general');
    const findings = [inRange, belowRange, aboveRange, general];

    const { filtered, dropped } = filterOutOfRangeFindings(findings, hunkRange);
    expect(filtered).toEqual([inRange, general]);
    expect(dropped).toEqual([belowRange, aboveRange]);
  });

  it('returns empty arrays for empty input', () => {
    const { filtered, dropped } = filterOutOfRangeFindings([], hunkRange);
    expect(filtered).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

describe('resolveToolPolicy', () => {
  const baseSkill: SkillDefinition = {
    name: 'test-skill',
    description: 'test',
    prompt: 'test prompt',
  };

  it('uses read-only defaults for claude provider', () => {
    const policy = resolveToolPolicy('claude', baseSkill);
    expect(policy.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(policy.disallowedTools).toContain('Write');
    expect(policy.disallowedTools).toContain('Bash');
  });

  it('enables shell/read/write defaults for pi provider', () => {
    const policy = resolveToolPolicy('pi', baseSkill);
    expect(policy.allowedTools).toContain('Read');
    expect(policy.allowedTools).toContain('Write');
    expect(policy.allowedTools).toContain('Bash');
    expect(policy.disallowedTools).not.toContain('Write');
    expect(policy.disallowedTools).not.toContain('Bash');
  });

  it('applies skill allowed-tools override and denied-tools filtering', () => {
    const policy = resolveToolPolicy('pi', {
      ...baseSkill,
      tools: {
        allowed: ['Read', 'Write', 'Bash'],
        denied: ['Write'],
      },
    });
    expect(policy.allowedTools).toEqual(['Read', 'Bash']);
    expect(policy.disallowedTools).toContain('Write');
  });
});
