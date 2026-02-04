import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineCouncilMember } from './member.js';

// Create a mock create function we can control
const mockCreate = vi.fn();

// Mock Anthropic before importing convene
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Import after mocking
const { convene, conveneWithFallback } = await import('./convene.js');

const testMember = defineCouncilMember({
  name: 'test-member',
  description: 'A test council member',
  buildPrompt: (input: { value: string }) => `Test prompt: ${input.value}`,
  schema: z.object({
    result: z.boolean(),
    reason: z.string(),
  }),
});

describe('convene', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns successful verdict when LLM returns valid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"result": true, "reason": "looks good"}' }],
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.result).toBe(true);
      expect(result.verdict.reason).toBe('looks good');
    }
  });

  it('extracts JSON from surrounding text', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Here is my analysis:\n{"result": false, "reason": "issue found"}\nHope this helps!' }],
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.result).toBe(false);
    }
  });

  it('returns error when response has no JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'No JSON here!' }],
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No JSON');
    }
  });

  it('returns error when JSON does not match schema', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"wrong": "shape"}' }],
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid verdict');
    }
  });

  it('returns error when API call fails', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('API error');
    }
  });

  it('returns error when response is empty', async () => {
    mockCreate.mockResolvedValue({
      content: [],
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Empty response');
    }
  });
});

describe('conveneWithFallback', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns verdict on success', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"result": true, "reason": "success"}' }],
    });

    const fallback = { result: false, reason: 'fallback' };
    const result = await conveneWithFallback(testMember, { value: 'test' }, { apiKey: 'test-key' }, fallback);

    expect(result.result).toBe(true);
    expect(result.reason).toBe('success');
  });

  it('returns fallback on failure', async () => {
    mockCreate.mockRejectedValue(new Error('fail'));

    const fallback = { result: false, reason: 'fallback' };
    const result = await conveneWithFallback(testMember, { value: 'test' }, { apiKey: 'test-key' }, fallback);

    expect(result.result).toBe(false);
    expect(result.reason).toBe('fallback');
  });
});
