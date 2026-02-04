import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { evaluateFixAttempts } from './orchestrator.js';
import type { ExistingComment } from '../dedup.js';
import { generateContentHash } from '../dedup.js';
import type { Finding } from '../../types/index.js';

// Mock the LLM evaluator to avoid actual API calls
vi.mock('./llm-evaluator.js', () => ({
  evaluateFix: vi.fn(),
}));

// Mock GitHub actions
vi.mock('./github-actions.js', () => ({
  fetchFollowUpPatches: vi.fn(),
  formatFailedFixReply: vi.fn((sha, reasoning) => `Fix attempt (${sha.slice(0, 7)}): ${reasoning}`),
}));

import { evaluateFix } from './llm-evaluator.js';
import { fetchFollowUpPatches } from './github-actions.js';

const mockedEvaluateFix = vi.mocked(evaluateFix);
const mockedFetchFollowUpPatches = vi.mocked(fetchFollowUpPatches);

// Mock Octokit - we won't use it directly since we mock fetchFollowUpPatches
const mockOctokit = {} as Octokit;

const context = {
  owner: 'test-owner',
  repo: 'test-repo',
  previousSha: 'abc123',
  currentSha: 'def456',
};

describe('evaluateFixAttempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when no comments provided', async () => {
    const result = await evaluateFixAttempts(mockOctokit, [], context, [], 'api-key');

    expect(result.toResolve).toHaveLength(0);
    expect(result.toReply).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.evaluated).toBe(0);
  });

  it('skips non-Warden comments', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: false,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(0);
    expect(mockedEvaluateFix).not.toHaveBeenCalled();
  });

  it('skips resolved comments', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
        isResolved: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(0);
  });

  it('skips comments without threadId', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        isWarden: true,
        // No threadId
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(0);
  });

  it('skips comments not touched by patches', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 200, // Far from patch
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.skipped).toBe(1);
    expect(result.evaluated).toBe(0);
    expect(mockedEvaluateFix).not.toHaveBeenCalled();
  });

  it('skips when judge says not attempted', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));
    mockedEvaluateFix.mockResolvedValue({
      status: 'not_attempted',
      reasoning: 'Unrelated change',
    });

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(1);
    expect(result.toResolve).toHaveLength(0);
    expect(result.toReply).toHaveLength(0);
  });

  it('resolves comment when fix successful and not re-detected', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'SQL Injection',
        description: 'User input in query',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));
    mockedEvaluateFix.mockResolvedValue({
      status: 'resolved',
      reasoning: 'Properly sanitized with parameterized query',
    });

    // No re-detection (empty findings)
    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.toResolve).toHaveLength(1);
    expect(result.toResolve[0]!.id).toBe(1);
    expect(result.toReply).toHaveLength(0);
  });

  it('posts reply when issue re-detected', async () => {
    const comment: ExistingComment = {
      id: 1,
      path: 'src/db.ts',
      line: 42,
      title: 'SQL Injection',
      description: 'User input in query',
      contentHash: generateContentHash('SQL Injection', 'User input in query'),
      threadId: 'thread-1',
      isWarden: true,
    };

    const reDetectedFinding: Finding = {
      id: 'f1',
      severity: 'high',
      title: 'SQL Injection',
      description: 'User input in query',
      location: { path: 'src/db.ts', startLine: 42 },
    };

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));
    mockedEvaluateFix.mockResolvedValue({
      status: 'resolved', // Judge thinks it's fixed
      reasoning: 'Tried to fix',
    });

    const result = await evaluateFixAttempts(
      mockOctokit,
      [comment],
      context,
      [reDetectedFinding],
      'api-key'
    );

    // But re-detection overrides LLM judgment
    expect(result.toResolve).toHaveLength(0);
    expect(result.toReply).toHaveLength(1);
    expect(result.toReply[0]!.comment.id).toBe(1);
  });

  it('posts reply when fix attempted but failed', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']]));
    mockedEvaluateFix.mockResolvedValue({
      status: 'attempted_failed',
      reasoning: 'Edge case not handled',
    });

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.toResolve).toHaveLength(0);
    expect(result.toReply).toHaveLength(1);
    expect(result.toReply[0]!.replyBody).toContain('Edge case not handled');
  });

  it('returns all skipped when no patches fetched', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
      {
        id: 2,
        path: 'src/api.ts',
        line: 10,
        title: 'Issue 2',
        description: 'Desc 2',
        contentHash: 'def',
        threadId: 'thread-2',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(new Map());

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.skipped).toBe(2);
    expect(result.evaluated).toBe(0);
  });

  it('handles multiple comments with mixed results', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/db.ts',
        line: 42,
        title: 'Issue 1',
        description: 'Desc 1',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
      {
        id: 2,
        path: 'src/db.ts',
        line: 100,
        title: 'Issue 2',
        description: 'Desc 2',
        contentHash: 'def',
        threadId: 'thread-2',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpPatches.mockResolvedValue(
      new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code\n@@ -98,5 +100,7 @@\n+more']])
    );

    // First comment: resolved, second: failed
    mockedEvaluateFix
      .mockResolvedValueOnce({ status: 'resolved', reasoning: 'Good fix' })
      .mockResolvedValueOnce({ status: 'attempted_failed', reasoning: 'Bad fix' });

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.toResolve).toHaveLength(1);
    expect(result.toResolve[0]!.id).toBe(1);
    expect(result.toReply).toHaveLength(1);
    expect(result.toReply[0]!.comment.id).toBe(2);
  });
});
