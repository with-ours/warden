import { describe, it, expect, vi } from 'vitest';
import type { Finding } from './types/index.js';
import { getFindingFingerprint, setFindingStageAttributes } from './sentry.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'ABC-123',
    severity: 'high',
    confidence: 'medium',
    title: 'SQL injection',
    description: 'User input reaches a query without parameterization.',
    verification: 'Read src/db/query.ts and traced the call path.',
    elapsedMs: 45,
    location: { path: 'src/db/query.ts', startLine: 12, endLine: 14 },
    additionalLocations: [{ path: 'src/db/other.ts', startLine: 30, endLine: 31 }],
    suggestedFix: {
      description: 'Use bound parameters.',
      diff: '- db.query(sql)\n+ db.query(sql, [id])',
    },
    ...overrides,
  };
}

describe('setFindingStageAttributes', () => {
  it('flattens findings into indexed span attributes', () => {
    const span = {
      setAttributes: vi.fn(),
      spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1' }),
    };

    setFindingStageAttributes(span, 'initial', [makeFinding()], { skill: 'security-review' });

    expect(span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({
      'warden.findings.stage': 'initial',
      'warden.findings.count': 1,
      'warden.findings.trace_id': 'trace-1',
      'warden.findings.span_id': 'span-1',
      'warden.findings.skill': 'security-review',
      'warden.findings.0.id': 'ABC-123',
      'warden.findings.0.severity': 'high',
      'warden.findings.0.confidence': 'medium',
      'warden.findings.0.title': 'SQL injection',
      'warden.findings.0.description': 'User input reaches a query without parameterization.',
      'warden.findings.0.verification': 'Read src/db/query.ts and traced the call path.',
      'warden.findings.0.elapsed_ms': 45,
      'warden.findings.0.location.path': 'src/db/query.ts',
      'warden.findings.0.location.start_line': 12,
      'warden.findings.0.location.end_line': 14,
      'warden.findings.0.suggested_fix.description': 'Use bound parameters.',
      'warden.findings.0.suggested_fix.diff': '- db.query(sql)\n+ db.query(sql, [id])',
      'warden.findings.0.additional_locations.count': 1,
      'warden.findings.0.additional_locations.0.path': 'src/db/other.ts',
      'warden.findings.0.additional_locations.0.start_line': 30,
      'warden.findings.0.additional_locations.0.end_line': 31,
    }));
  });
});

describe('getFindingFingerprint', () => {
  it('is stable for the same finding payload', () => {
    const finding = makeFinding();

    expect(getFindingFingerprint(finding)).toBe(getFindingFingerprint({ ...finding }));
  });
});
