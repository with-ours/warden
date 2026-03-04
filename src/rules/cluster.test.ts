import { describe, it, expect } from 'vitest';
import { normalizeTitle, clusterFindings } from './cluster.js';
import type { Finding } from '../types/index.js';

describe('normalizeTitle', () => {
  it('lowercases and strips code tokens', () => {
    expect(normalizeTitle('Use `dict.get()` instead of bracket access')).toBe('use instead of bracket access');
  });

  it('strips numbers', () => {
    expect(normalizeTitle('Found 3 issues on line 42')).toBe('found issues on line');
  });

  it('strips hex hashes', () => {
    expect(normalizeTitle('Commit abc1234f introduced regression')).toBe('commit introduced regression');
  });

  it('strips file paths', () => {
    expect(normalizeTitle('Issue in auth.py with imports')).toBe('issue in with imports');
  });

  it('collapses whitespace', () => {
    expect(normalizeTitle('  too   many   spaces  ')).toBe('too many spaces');
  });

  it('returns empty for empty input', () => {
    expect(normalizeTitle('')).toBe('');
  });
});

describe('clusterFindings', () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: 'f1',
      severity: 'medium',
      title: 'Bare except clause',
      description: 'Do not use bare except',
      ...overrides,
    };
  }

  it('groups findings with matching normalized titles', () => {
    const inputs = [
      { finding: makeFinding({ id: 'f1', title: 'Bare except clause' }), skill: 'security', runId: 'run1' },
      { finding: makeFinding({ id: 'f2', title: 'bare except clause' }), skill: 'security', runId: 'run2' },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.runCount).toBe(2);
    expect(clusters[0]?.skills).toContain('security');
  });

  it('filters by minOccurrences', () => {
    const inputs = [
      { finding: makeFinding({ id: 'f1', title: 'One-off issue' }), skill: 'security', runId: 'run1' },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters).toHaveLength(0);
  });

  it('collects unique skills from multiple runs', () => {
    const inputs = [
      { finding: makeFinding({ id: 'f1', title: 'Bare except' }), skill: 'security', runId: 'run1' },
      { finding: makeFinding({ id: 'f2', title: 'bare except' }), skill: 'code-quality', runId: 'run2' },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters[0]?.skills).toEqual(expect.arrayContaining(['security', 'code-quality']));
  });

  it('determines most common severity', () => {
    const inputs = [
      { finding: makeFinding({ id: 'f1', title: 'Issue', severity: 'high' }), skill: 's', runId: 'r1' },
      { finding: makeFinding({ id: 'f2', title: 'issue', severity: 'medium' }), skill: 's', runId: 'r2' },
      { finding: makeFinding({ id: 'f3', title: 'Issue', severity: 'medium' }), skill: 's', runId: 'r3' },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters[0]?.severity).toBe('medium');
  });

  it('collects file paths from finding locations', () => {
    const inputs = [
      {
        finding: makeFinding({ id: 'f1', title: 'Issue', location: { path: 'src/auth.py', startLine: 10 } }),
        skill: 's',
        runId: 'r1',
      },
      {
        finding: makeFinding({ id: 'f2', title: 'issue', location: { path: 'src/api.py', startLine: 20 } }),
        skill: 's',
        runId: 'r2',
      },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters[0]?.paths).toEqual(expect.arrayContaining(['src/auth.py', 'src/api.py']));
  });

  it('sorts by run count descending', () => {
    const inputs = [
      { finding: makeFinding({ id: 'f1', title: 'Rare' }), skill: 's', runId: 'r1' },
      { finding: makeFinding({ id: 'f2', title: 'rare' }), skill: 's', runId: 'r2' },
      { finding: makeFinding({ id: 'f3', title: 'Common' }), skill: 's', runId: 'r1' },
      { finding: makeFinding({ id: 'f4', title: 'common' }), skill: 's', runId: 'r2' },
      { finding: makeFinding({ id: 'f5', title: 'Common' }), skill: 's', runId: 'r3' },
    ];

    const clusters = clusterFindings(inputs, 2);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.runCount).toBe(3);
    expect(clusters[1]?.runCount).toBe(2);
  });
});
