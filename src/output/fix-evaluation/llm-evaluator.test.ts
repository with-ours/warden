import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildFixPrompt, parseEvaluationResponse } from './llm-evaluator.js';
import type { ExistingComment } from '../dedup.js';

const mockComment: ExistingComment = {
  id: 1,
  path: 'src/db.ts',
  line: 42,
  title: 'SQL Injection Vulnerability',
  description: 'User input is passed directly to the query without sanitization',
  contentHash: 'abc12345',
  threadId: 'thread-1',
};

const mockPatch = `@@ -40,5 +40,7 @@ function getUser(id: string) {
-  const query = \`SELECT * FROM users WHERE id = '\${id}'\`;
+  const query = 'SELECT * FROM users WHERE id = ?';
+  const params = [id];
   return db.query(query);
 }`;

describe('buildFixPrompt', () => {
  it('includes comment details', () => {
    const prompt = buildFixPrompt(mockComment, mockPatch);

    expect(prompt).toContain('SQL Injection Vulnerability');
    expect(prompt).toContain('User input is passed directly');
    expect(prompt).toContain('src/db.ts:42');
  });

  it('includes patch content', () => {
    const prompt = buildFixPrompt(mockComment, mockPatch);

    expect(prompt).toContain(mockPatch);
    expect(prompt).toContain('```diff');
  });

  it('describes all three status options', () => {
    const prompt = buildFixPrompt(mockComment, mockPatch);

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
