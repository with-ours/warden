import { describe, it, expect } from 'vitest';
import { buildAnalyzedScope, isInAnalyzedScope, findStaleComments } from './stale.js';
import { generateContentHash } from './dedup.js';
import type { ExistingComment } from './dedup.js';
import type { FileChange } from '../types/index.js';

/** Helper to create test comments with sensible defaults */
function createComment(overrides: Partial<ExistingComment> & { id: number; path: string }): ExistingComment {
  const title = overrides.title ?? 'Test Issue';
  const description = overrides.description ?? 'Test description';
  return {
    line: 42,
    title,
    description,
    contentHash: overrides.contentHash ?? generateContentHash(title, description),
    threadId: 'thread-default',
    ...overrides,
  };
}

describe('buildAnalyzedScope', () => {
  it('creates scope from file changes', () => {
    const files: FileChange[] = [
      { filename: 'src/db.ts', status: 'modified', additions: 10, deletions: 5 },
      { filename: 'src/api.ts', status: 'added', additions: 50, deletions: 0 },
    ];

    const scope = buildAnalyzedScope(files);
    expect(scope.files.has('src/db.ts')).toBe(true);
    expect(scope.files.has('src/api.ts')).toBe(true);
    expect(scope.files.has('src/other.ts')).toBe(false);
  });

  it('handles empty file list', () => {
    const scope = buildAnalyzedScope([]);
    expect(scope.files.size).toBe(0);
  });
});

describe('isInAnalyzedScope', () => {
  const scope = buildAnalyzedScope([
    { filename: 'src/db.ts', status: 'modified', additions: 10, deletions: 5 },
    { filename: 'src/api.ts', status: 'added', additions: 50, deletions: 0 },
  ]);

  it('returns true for comment on analyzed file', () => {
    const comment = createComment({ id: 1, path: 'src/db.ts' });
    expect(isInAnalyzedScope(comment, scope)).toBe(true);
  });

  it('returns false for comment on non-analyzed file', () => {
    const comment = createComment({ id: 2, path: 'src/other.ts' });
    expect(isInAnalyzedScope(comment, scope)).toBe(false);
  });
});

describe('findStaleComments', () => {
  const scope = buildAnalyzedScope([
    { filename: 'src/db.ts', status: 'modified', additions: 10, deletions: 5 },
    { filename: 'src/api.ts', status: 'added', additions: 50, deletions: 0 },
  ]);

  // Note: findings parameter is unused by findStaleComments (kept for API compatibility)
  // These tests pass empty arrays to make that explicit

  it('returns empty array when no existing comments', () => {
    const stale = findStaleComments([], [], scope);
    expect(stale).toHaveLength(0);
  });

  it('keeps comment when file is in scope (fix evaluation handles resolution)', () => {
    const comments = [createComment({ id: 1, path: 'src/db.ts' })];
    const stale = findStaleComments(comments, [], scope);
    expect(stale).toHaveLength(0);
  });

  it('skips comments without threadId', () => {
    const comments = [createComment({ id: 1, path: 'src/db.ts', threadId: undefined })];
    const stale = findStaleComments(comments, [], scope);
    expect(stale).toHaveLength(0);
  });

  it('skips already-resolved comments', () => {
    const comments = [createComment({ id: 1, path: 'src/db.ts', isResolved: true })];
    const stale = findStaleComments(comments, [], scope);
    expect(stale).toHaveLength(0);
  });

  it('marks orphaned comments (file not in scope) as stale', () => {
    const comments = [createComment({ id: 1, path: 'src/other.ts' })];
    const stale = findStaleComments(comments, [], scope);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.id).toBe(1);
  });

  it('filters multiple comments - only orphaned ones are stale', () => {
    const comments = [
      createComment({ id: 1, path: 'src/db.ts', title: 'SQL Injection' }),
      createComment({ id: 2, path: 'src/api.ts', title: 'Missing Error Handling' }),
      createComment({ id: 3, path: 'src/removed.ts', title: 'XSS Vulnerability' }),
    ];

    const stale = findStaleComments(comments, [], scope);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.id).toBe(3);
  });
});
