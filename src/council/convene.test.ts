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

/** Mock usage to include in responses */
const mockUsage = { input_tokens: 100, output_tokens: 50 };

// Note: convene auto-prefills based on schema type ('{' for objects, '[' for arrays).
// Mock responses should NOT include the leading character since prefill provides it.

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
      content: [{ type: 'text', text: '"result": true, "reason": "looks good"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.result).toBe(true);
      expect(result.verdict.reason).toBe('looks good');
    }
  });

  it('handles trailing text after JSON', async () => {
    // With prefill, model continues from '{' so there's no leading text,
    // but there may be trailing content after the closing brace
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"result": false, "reason": "issue found"}\nHope this helps!' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
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
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No JSON');
    }
  });

  it('returns error when JSON does not match schema', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"wrong": "shape"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
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
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await convene(testMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Empty response');
    }
  });
});

describe('convene with tools', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const toolMember = defineCouncilMember({
    name: 'tool-member',
    description: 'A member with tools',
    buildPrompt: (input: { value: string }) => `Tool test: ${input.value}`,
    schema: z.object({
      result: z.boolean(),
      reason: z.string(),
    }),
    tools: [
      {
        name: 'get_data',
        description: 'Gets some data',
        inputSchema: z.object({
          key: z.string(),
        }),
        execute: async (input) => `Data for ${(input as { key: string }).key}`,
      },
    ],
    maxToolIterations: 2,
  });

  it('handles tool use and continues to verdict', async () => {
    // First call: model wants to use a tool
    mockCreate
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me check the data' },
          { type: 'tool_use', id: 'tool-1', name: 'get_data', input: { key: 'test' } },
        ],
        stop_reason: 'tool_use',
        usage: mockUsage,
      })
      // Second call: model returns verdict after seeing tool result (no leading { due to prefill)
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '"result": true, "reason": "Data confirmed it"}' }],
        stop_reason: 'end_turn',
        usage: mockUsage,
      });

    const result = await convene(toolMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verdict.result).toBe(true);
      expect(result.verdict.reason).toBe('Data confirmed it');
    }

    // Verify the tool result was passed back
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const secondCall = mockCreate.mock.calls[1];
    expect(secondCall).toBeDefined();
    if (secondCall) {
      const secondCallMessages = secondCall[0].messages;
      // Messages: user prompt, assistant prefill, assistant with tool use, user with tool result
      expect(secondCallMessages).toHaveLength(4);
      expect(secondCallMessages[3].role).toBe('user');
      expect(secondCallMessages[3].content[0].type).toBe('tool_result');
      expect(secondCallMessages[3].content[0].content).toBe('Data for test');
    }
  });

  it('returns error when max tool iterations exceeded', async () => {
    // Keep returning tool_use, never end_turn
    mockCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'get_data', input: { key: 'test' } },
      ],
      stop_reason: 'tool_use',
      usage: mockUsage,
    });

    const result = await convene(toolMember, { value: 'test' }, { apiKey: 'test-key' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Max tool iterations');
    }
  });

  it('passes tool context to tool execution', async () => {
    const contextAwareMember = defineCouncilMember({
      name: 'context-member',
      description: 'Uses context',
      buildPrompt: () => 'Test',
      schema: z.object({ result: z.string() }),
      tools: [
        {
          name: 'use_context',
          description: 'Uses context',
          inputSchema: z.object({}),
          execute: async (_input, _memberInput, context) => {
            return `Secret: ${(context as { secret: string }).secret}`;
          },
        },
      ],
    });

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'use_context', input: {} }],
        stop_reason: 'tool_use',
        usage: mockUsage,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '"result": "got it"}' }],
        stop_reason: 'end_turn',
        usage: mockUsage,
      });

    await convene(
      contextAwareMember,
      {},
      { apiKey: 'test-key', toolContext: { secret: 'mysecret' } }
    );

    // Check that the tool result includes the secret from context
    const secondCall = mockCreate.mock.calls[1];
    expect(secondCall).toBeDefined();
    if (secondCall) {
      const secondCallMessages = secondCall[0].messages;
      // Messages: user prompt, assistant prefill, assistant with tool use, user with tool result
      const toolResult = secondCallMessages[3].content[0];
      expect(toolResult.content).toBe('Secret: mysecret');
    }
  });

  it('returns debug metadata when debug option is enabled', async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tool-1', name: 'get_data', input: { key: 'test' } },
        ],
        stop_reason: 'tool_use',
        usage: mockUsage,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '"result": true, "reason": "done"}' }],
        stop_reason: 'end_turn',
        usage: mockUsage,
      });

    const result = await convene(toolMember, { value: 'test' }, { apiKey: 'test-key', debug: true });

    expect(result.success).toBe(true);
    expect(result.debug).toBeDefined();
    expect(result.debug?.toolIterations).toBe(1);
    expect(result.debug?.toolCalls).toHaveLength(1);
    expect(result.debug?.toolCalls[0]?.name).toBe('get_data');
    expect(result.debug?.toolCalls[0]?.input).toEqual({ key: 'test' });
    expect(result.debug?.toolCalls[0]?.result).toBe('Data for test');
    expect(result.debug?.toolCalls[0]?.isError).toBe(false);
  });

  it('does not include debug metadata when debug option is false', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"result": true, "reason": "done"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const result = await convene(toolMember, { value: 'test' }, { apiKey: 'test-key', debug: false });

    expect(result.success).toBe(true);
    expect(result.debug).toBeUndefined();
  });
});

describe('conveneWithFallback', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns verdict on success', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"result": true, "reason": "success"}' }],
      stop_reason: 'end_turn',
      usage: mockUsage,
    });

    const fallback = { result: false, reason: 'fallback' };
    const result = await conveneWithFallback(testMember, { value: 'test' }, { apiKey: 'test-key' }, fallback);

    expect(result.verdict.result).toBe(true);
    expect(result.verdict.reason).toBe('success');
    expect(result.usedFallback).toBe(false);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('returns fallback on failure', async () => {
    mockCreate.mockRejectedValue(new Error('fail'));

    const fallback = { result: false, reason: 'fallback' };
    const result = await conveneWithFallback(testMember, { value: 'test' }, { apiKey: 'test-key' }, fallback);

    expect(result.verdict.result).toBe(false);
    expect(result.verdict.reason).toBe('fallback');
    expect(result.usedFallback).toBe(true);
  });
});
