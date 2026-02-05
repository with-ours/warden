import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { evaluateFixAttempts } from './orchestrator.js';
import type { ExistingComment } from '../dedup.js';
import { generateContentHash } from '../dedup.js';
import type { Finding } from '../../types/index.js';
import type { EvaluateFixResult } from './llm-evaluator.js';

// Mock the LLM evaluator to avoid actual API calls
vi.mock('./llm-evaluator.js', () => ({
  evaluateFix: vi.fn(),
}));

// Mock GitHub actions
vi.mock('./github-actions.js', () => ({
  fetchFollowUpChanges: vi.fn(),
  fetchFileContent: vi.fn(),
  formatFailedFixReply: vi.fn((sha, reasoning) => `Fix attempt (${sha.slice(0, 7)}): ${reasoning}`),
}));

import { evaluateFix } from './llm-evaluator.js';
import { fetchFollowUpChanges, fetchFileContent } from './github-actions.js';

const mockedEvaluateFix = vi.mocked(evaluateFix);
const mockedFetchFollowUpChanges = vi.mocked(fetchFollowUpChanges);
const mockedFetchFileContent = vi.mocked(fetchFileContent);

/** Helper to create mock follow-up changes result */
function mockFollowUpChanges(patches: Map<string, string>, commitMessages: string[] = []): { patches: Map<string, string>; commitMessages: string[] } {
  return { patches, commitMessages };
}

/** Helper to create mock evaluation result */
function mockEvalResult(
  status: 'not_attempted' | 'attempted_failed' | 'resolved',
  reasoning: string
): EvaluateFixResult {
  return {
    verdict: { status, reasoning },
    usage: { inputTokens: 100, outputTokens: 50, costUSD: 0.0003 },
    usedFallback: false,
  };
}

/** Helper to create a fallback (failed) evaluation result */
function mockFallbackResult(): EvaluateFixResult {
  return {
    verdict: { status: 'not_attempted', reasoning: 'Evaluation failed' },
    usage: { inputTokens: 50, outputTokens: 10, costUSD: 0.0001 },
    usedFallback: true,
  };
}

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
    expect(result.failedEvaluations).toBe(0);
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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));

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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));

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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(0);
  });

  it('evaluates comments even when in different file than patches', async () => {
    const comments: ExistingComment[] = [
      {
        id: 1,
        path: 'src/other.ts', // Different file than the patch
        line: 42,
        title: 'Issue',
        description: 'Desc',
        contentHash: 'abc',
        threadId: 'thread-1',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));
    mockedFetchFileContent.mockResolvedValue('line 42');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('not_attempted', 'Changes in different file'));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    // We evaluate all unresolved comments, judge decides relevance
    expect(result.evaluated).toBe(1);
    expect(mockedEvaluateFix).toHaveBeenCalled();
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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));
    mockedFetchFileContent.mockResolvedValue('line 32\nline 33\nline 34\nline 35\nline 36\nline 37\nline 38\nline 39\nline 40\nline 41\nline 42: vulnerable code\nline 43\nline 44\nline 45\nline 46\nline 47\nline 48\nline 49\nline 50\nline 51\nline 52');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('not_attempted', 'Unrelated change'));

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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));
    mockedFetchFileContent.mockResolvedValue('line 32\nline 33\nline 34\nline 35\nline 36\nline 37\nline 38\nline 39\nline 40\nline 41\nline 42: fixed code\nline 43\nline 44\nline 45\nline 46\nline 47\nline 48\nline 49\nline 50\nline 51\nline 52');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('resolved', 'Properly sanitized with parameterized query'));

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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));
    mockedFetchFileContent.mockResolvedValue('line 32\nline 33\nline 34\nline 35\nline 36\nline 37\nline 38\nline 39\nline 40\nline 41\nline 42: still vulnerable\nline 43\nline 44\nline 45\nline 46\nline 47\nline 48\nline 49\nline 50\nline 51\nline 52');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('resolved', 'Tried to fix'));

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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code']])));
    mockedFetchFileContent.mockResolvedValue('line 32\nline 33\nline 34\nline 35\nline 36\nline 37\nline 38\nline 39\nline 40\nline 41\nline 42: partially fixed\nline 43\nline 44\nline 45\nline 46\nline 47\nline 48\nline 49\nline 50\nline 51\nline 52');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('attempted_failed', 'Edge case not handled'));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.toResolve).toHaveLength(0);
    expect(result.toReply).toHaveLength(1);
    expect(result.toReply[0]!.replyBody).toContain('Edge case not handled');
  });

  it('tracks failed evaluations when fallback is used', async () => {
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
        path: 'src/api.ts',
        line: 10,
        title: 'Issue 2',
        description: 'Desc 2',
        contentHash: 'def',
        threadId: 'thread-2',
        isWarden: true,
      },
    ];

    mockedFetchFollowUpChanges.mockResolvedValue(
      mockFollowUpChanges(new Map([
        ['src/db.ts', '@@ -40,5 +40,7 @@\n+code'],
        ['src/api.ts', '@@ -8,5 +8,7 @@\n+code'],
      ]))
    );
    mockedFetchFileContent.mockResolvedValue('line 42');

    // First comment: evaluation failed (fallback), second: resolved
    mockedEvaluateFix
      .mockResolvedValueOnce(mockFallbackResult())
      .mockResolvedValueOnce(mockEvalResult('resolved', 'Good fix'));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.evaluated).toBe(2);
    expect(result.failedEvaluations).toBe(1);
    expect(result.toResolve).toHaveLength(1);
    expect(result.toReply).toHaveLength(0);
    // Usage should still be accumulated even for failed evaluations
    expect(result.usage.inputTokens).toBeGreaterThan(100);
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

    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map()));

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

    mockedFetchFollowUpChanges.mockResolvedValue(
      mockFollowUpChanges(new Map([['src/db.ts', '@@ -40,5 +40,7 @@\n+code\n@@ -98,5 +100,7 @@\n+more']]))
    );
    // Return different content for different lines (we need at least 100 lines for the second comment)
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    mockedFetchFileContent.mockResolvedValue(lines.join('\n'));

    // First comment: resolved, second: failed
    mockedEvaluateFix
      .mockResolvedValueOnce(mockEvalResult('resolved', 'Good fix'))
      .mockResolvedValueOnce(mockEvalResult('attempted_failed', 'Bad fix'));

    const result = await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    expect(result.toResolve).toHaveLength(1);
    expect(result.toResolve[0]!.id).toBe(1);
    expect(result.toReply).toHaveLength(1);
    expect(result.toReply[0]!.comment.id).toBe(2);
  });

  it('passes patches to tool context for get_file_diff tool', async () => {
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

    const patchContent = '@@ -40,5 +40,7 @@\n+fixed code';
    mockedFetchFollowUpChanges.mockResolvedValue(mockFollowUpChanges(new Map([['src/db.ts', patchContent]])));
    mockedFetchFileContent.mockResolvedValue('line 42');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('resolved', 'Fixed'));

    await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    // Verify patches are passed in toolContext
    expect(mockedEvaluateFix).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: expect.any(Object),
        changedFiles: ['src/db.ts'],
        codeBeforeFix: expect.any(String),
      }),
      expect.objectContaining({
        toolContext: expect.objectContaining({
          patches: expect.any(Map),
        }),
      })
    );

    // Verify the actual patches map content
    const callArgs = mockedEvaluateFix.mock.calls[0];
    const toolContext = callArgs?.[1]?.toolContext;
    expect(toolContext?.patches?.get('src/db.ts')).toBe(patchContent);
  });

  it('passes all changed files to evaluator', async () => {
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

    // Multiple files changed
    mockedFetchFollowUpChanges.mockResolvedValue(
      mockFollowUpChanges(new Map([
        ['src/db.ts', '@@ -40,5 +40,7 @@\n+code'],
        ['src/utils.ts', '@@ -10,3 +10,5 @@\n+helper'],
      ]))
    );
    mockedFetchFileContent.mockResolvedValue('line 42');
    mockedEvaluateFix.mockResolvedValue(mockEvalResult('resolved', 'Fixed'));

    await evaluateFixAttempts(mockOctokit, comments, context, [], 'api-key');

    // Verify changedFiles includes all changed files (not just the comment's file)
    expect(mockedEvaluateFix).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFiles: expect.arrayContaining(['src/db.ts', 'src/utils.ts']),
      }),
      expect.any(Object)
    );
  });
});
