import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExistingComment } from '../dedup.js';

// Mock Anthropic before importing evaluateFix
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import after mocking
const { evaluateFix } = await import('./llm-evaluator.js');

const mockComment: ExistingComment = {
  id: 1,
  path: 'src/db.ts',
  line: 42,
  title: 'SQL Injection Vulnerability',
  description: 'User input is passed directly to the query without sanitization',
  contentHash: 'abc12345',
  threadId: 'thread-1',
};

const mockChangedFiles = ['src/db.ts', 'src/utils.ts'];

const mockCodeBeforeFix = `40: function getUser(id: string) {
41:   // Get user by ID
42:   const query = \`SELECT * FROM users WHERE id = '\${id}'\`;
43:   return db.query(query);
44: }`;

// Note: Prompt structure tests are in fix-judge.integration.test.ts
// These tests focus on the evaluateFix function's behavior with mocked API responses

describe('evaluateFix', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  /** Mock usage to include in responses */
  const mockUsage = { input_tokens: 100, output_tokens: 50 };

  const mockInput = {
    comment: mockComment,
    changedFiles: mockChangedFiles,
    codeBeforeFix: mockCodeBeforeFix,
  };

  // Note: fix-judge uses prefill: '{' which convene.ts prepends to response text.
  // Mock responses should NOT include the leading '{' since prefill provides it.

  it('returns resolved status when fix succeeds', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"status": "resolved", "reasoning": "Fix correctly addresses the issue"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await evaluateFix(mockInput, { apiKey: 'test-api-key' });

    expect(result.verdict.status).toBe('resolved');
    expect(result.verdict.reasoning).toBe('Fix correctly addresses the issue');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('returns attempted_failed when fix is incorrect', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"status": "attempted_failed", "reasoning": "Edge case not handled"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await evaluateFix(mockInput, { apiKey: 'test-api-key' });

    expect(result.verdict.status).toBe('attempted_failed');
    expect(result.verdict.reasoning).toContain('Edge case');
  });

  it('returns not_attempted when code is unchanged', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"status": "not_attempted", "reasoning": "Changes unrelated to the issue"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await evaluateFix(mockInput, { apiKey: 'test-api-key' });

    expect(result.verdict.status).toBe('not_attempted');
  });

  it('returns fallback on API error', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit'));

    const result = await evaluateFix(mockInput, { apiKey: 'test-api-key' });

    expect(result.verdict.status).toBe('not_attempted');
    expect(result.verdict.reasoning).toBe('Evaluation failed');
    expect(result.usedFallback).toBe(true);
  });

  it('returns fallback on invalid response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'No JSON here!' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await evaluateFix(mockInput, { apiKey: 'test-api-key' });

    expect(result.verdict.status).toBe('not_attempted');
    expect(result.verdict.reasoning).toBe('Evaluation failed');
  });
});
