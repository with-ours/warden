import { describe, it, expect } from 'vitest';
import { findCandidateFinding, createFindingTracker } from './judge.js';
import type { Finding } from '../types/index.js';
import type { ExpectedBug } from './types.js';

describe('findCandidateFinding', () => {
  const findings: Finding[] = [
    {
      id: 'finding-1',
      severity: 'critical',
      title: 'SQL Injection',
      description: 'SQL injection in getUserByUsername',
      location: { path: 'db.ts', startLine: 8 },
    },
    {
      id: 'finding-2',
      severity: 'high',
      title: 'Command Injection',
      description: 'Command injection in convertImage',
      location: { path: 'utils.ts', startLine: 6 },
    },
    {
      id: 'finding-3',
      severity: 'medium',
      title: 'Another issue',
      description: 'Another issue in db.ts',
      location: { path: 'db.ts', startLine: 25 },
    },
  ];

  it('finds candidate in same file', () => {
    const bug: ExpectedBug = {
      id: 'sql-1',
      file: 'db.ts',
      bug: 'SQL injection',
    };

    const candidate = findCandidateFinding(findings, bug);
    expect(candidate).not.toBeNull();
    expect(candidate?.location?.path).toBe('db.ts');
  });

  it('returns null when no finding in file', () => {
    const bug: ExpectedBug = {
      id: 'bug-1',
      file: 'other.ts',
      bug: 'Some bug',
    };

    const candidate = findCandidateFinding(findings, bug);
    expect(candidate).toBeNull();
  });

  it('finds closest finding by line number', () => {
    const bug: ExpectedBug = {
      id: 'sql-1',
      file: 'db.ts',
      bug: 'SQL injection',
      line: 10,
    };

    const candidate = findCandidateFinding(findings, bug);
    expect(candidate?.id).toBe('finding-1'); // Line 8 is closest to line 10
  });

  it('returns first finding when no line specified', () => {
    const bug: ExpectedBug = {
      id: 'bug-1',
      file: 'db.ts',
      bug: 'Some bug',
    };

    // When there are multiple findings in the same file and no line,
    // should return the first one
    const candidate = findCandidateFinding(findings, bug);
    expect(candidate).not.toBeNull();
    expect(candidate?.location?.path).toBe('db.ts');
  });
});

describe('createFindingTracker', () => {
  it('tracks used findings', () => {
    const tracker = createFindingTracker();

    expect(tracker.isUsed('finding-1')).toBe(false);

    tracker.markUsed('finding-1');
    expect(tracker.isUsed('finding-1')).toBe(true);
    expect(tracker.isUsed('finding-2')).toBe(false);
  });

  it('handles marking same finding multiple times', () => {
    const tracker = createFindingTracker();

    tracker.markUsed('finding-1');
    tracker.markUsed('finding-1');
    expect(tracker.isUsed('finding-1')).toBe(true);
  });
});
