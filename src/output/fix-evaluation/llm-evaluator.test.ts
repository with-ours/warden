import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { ExistingComment } from '../dedup.js';

// Mock Anthropic before importing evaluateFix
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import after mocking
const { buildFixPrompt, parseEvaluationResponse, evaluateFix } = await import('./llm-evaluator.js');

const mockComment: ExistingComment = {
  id: 1,
  path: 'src/db.ts',
  line: 42,
  title: 'SQL Injection Vulnerability',
  description: 'User input is passed directly to the query without sanitization',
  contentHash: 'abc12345',
  threadId: 'thread-1',
};

const mockBeforeCode = `40: function getUser(id: string) {
41:   // Get user by ID
42:   const query = \`SELECT * FROM users WHERE id = '\${id}'\`;
43:   return db.query(query);
44: }`;

const mockAfterCode = `40: function getUser(id: string) {
41:   // Get user by ID
42:   const query = 'SELECT * FROM users WHERE id = ?';
43:   const params = [id];
44:   return db.query(query, params);
45: }`;

describe('buildFixPrompt', () => {
  it('includes comment details', () => {
    const prompt = buildFixPrompt(mockComment, mockBeforeCode, mockAfterCode);

    expect(prompt).toContain('SQL Injection Vulnerability');
    expect(prompt).toContain('User input is passed directly');
    expect(prompt).toContain('src/db.ts:42');
  });

  it('includes before and after code', () => {
    const prompt = buildFixPrompt(mockComment, mockBeforeCode, mockAfterCode);

    expect(prompt).toContain('Code BEFORE');
    expect(prompt).toContain('Code AFTER');
    expect(prompt).toContain(mockBeforeCode);
    expect(prompt).toContain(mockAfterCode);
  });

  it('describes all three status options', () => {
    const prompt = buildFixPrompt(mockComment, mockBeforeCode, mockAfterCode);

    expect(prompt).toContain('not_attempted');
    expect(prompt).toContain('attempted_failed');
    expect(prompt).toContain('resolved');
  });
});

describe('parseEvaluationResponse', () => {
  const TestSchema = z.object({
    value: z.boolean(),
    reason: z.string(),
  });

  it('parses valid JSON response', () => {
    const response = '{"value": true, "reason": "It works"}';
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toEqual({ value: true, reason: 'It works' });
  });

  it('extracts JSON from text with surrounding content', () => {
    const response = `Here is my analysis:

{"value": false, "reason": "Missing edge case"}

I hope this helps!`;
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toEqual({ value: false, reason: 'Missing edge case' });
  });

  it('returns null for response without JSON', () => {
    const response = 'This is just text without any JSON';
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const response = '{"value": true, reason: missing quotes}';
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toBeNull();
  });

  it('returns null for JSON that does not match schema', () => {
    const response = '{"wrong_field": true}';
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toBeNull();
  });

  it('handles different schema shapes', () => {
    const AltSchema = z.object({
      status: z.string(),
      reasoning: z.string(),
    });

    const response = '{"status": "resolved", "reasoning": "The code was modified to fix the issue"}';
    const result = parseEvaluationResponse(response, AltSchema);

    expect(result).toEqual({
      status: 'resolved',
      reasoning: 'The code was modified to fix the issue',
    });
  });

  it('handles response with markdown formatting', () => {
    const response = `Based on my analysis:

\`\`\`json
{"value": true, "reason": "The fix addresses the issue"}
\`\`\`

This should work.`;
    const result = parseEvaluationResponse(response, TestSchema);

    expect(result).toEqual({ value: true, reason: 'The fix addresses the issue' });
  });
});

describe('evaluateFix', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns resolved status when fix succeeds', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"status": "resolved", "reasoning": "Fix correctly addresses the issue"}' }],
      stop_reason: 'end_turn',
    });

    const result = await evaluateFix(mockComment, mockBeforeCode, mockAfterCode, {
      apiKey: 'test-api-key',
    });

    expect(result.status).toBe('resolved');
    expect(result.reasoning).toBe('Fix correctly addresses the issue');
  });

  it('returns attempted_failed when fix is incorrect', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"status": "attempted_failed", "reasoning": "Edge case not handled"}' }],
      stop_reason: 'end_turn',
    });

    const result = await evaluateFix(mockComment, mockBeforeCode, mockAfterCode, {
      apiKey: 'test-api-key',
    });

    expect(result.status).toBe('attempted_failed');
    expect(result.reasoning).toContain('Edge case');
  });

  it('returns not_attempted when code is unchanged', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"status": "not_attempted", "reasoning": "Changes unrelated to the issue"}' }],
      stop_reason: 'end_turn',
    });

    const result = await evaluateFix(mockComment, mockBeforeCode, mockAfterCode, {
      apiKey: 'test-api-key',
    });

    expect(result.status).toBe('not_attempted');
  });

  it('returns fallback on API error', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit'));

    const result = await evaluateFix(mockComment, mockBeforeCode, mockAfterCode, {
      apiKey: 'test-api-key',
    });

    expect(result.status).toBe('not_attempted');
    expect(result.reasoning).toBe('Evaluation failed');
  });

  it('returns fallback on invalid response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'No JSON here!' }],
      stop_reason: 'end_turn',
    });

    const result = await evaluateFix(mockComment, mockBeforeCode, mockAfterCode, {
      apiKey: 'test-api-key',
    });

    expect(result.status).toBe('not_attempted');
    expect(result.reasoning).toBe('Evaluation failed');
  });
});
