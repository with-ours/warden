import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { executeTools, extractToolUseBlocks } from './tools.js';
import type { CouncilTool } from './types.js';

describe('extractToolUseBlocks', () => {
  it('extracts tool_use blocks from response content', () => {
    const content = [
      { type: 'text', text: 'Some text' },
      { type: 'tool_use', id: 'tool-1', name: 'get_file', input: { path: 'test.ts' } },
      { type: 'text', text: 'More text' },
    ];

    const result = extractToolUseBlocks(content);

    expect(result).toHaveLength(1);
    const block = result[0];
    expect(block).toBeDefined();
    if (block) {
      expect(block.name).toBe('get_file');
      expect(block.id).toBe('tool-1');
    }
  });

  it('returns empty array when no tool_use blocks present', () => {
    const content = [
      { type: 'text', text: 'Just text' },
    ];

    const result = extractToolUseBlocks(content);

    expect(result).toHaveLength(0);
  });
});

describe('executeTools', () => {
  it('executes a single tool and returns results', async () => {
    const tool: CouncilTool<{ value: string }> = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: z.object({
        message: z.string(),
      }),
      execute: async (input) => `Echo: ${(input as { message: string }).message}`,
    };

    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'echo', input: { message: 'hello' } },
    ];

    const results = await executeTools(toolCalls, [tool], { value: 'test' }, {});

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    if (result) {
      expect(result.tool_use_id).toBe('call-1');
      expect(result.content).toBe('Echo: hello');
      expect(result.is_error).toBeFalsy();
    }
  });

  it('returns error for unknown tool', async () => {
    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'unknown_tool', input: {} },
    ];

    const results = await executeTools(toolCalls, [], {}, {});

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    if (result) {
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Unknown tool');
    }
  });

  it('returns error for invalid input', async () => {
    const tool: CouncilTool<unknown> = {
      name: 'strict_tool',
      description: 'Requires specific input',
      inputSchema: z.object({
        required_field: z.string(),
      }),
      execute: async () => 'success',
    };

    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'strict_tool', input: { wrong_field: 123 } },
    ];

    const results = await executeTools(toolCalls, [tool], {}, {});

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    if (result) {
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Invalid tool input');
    }
  });

  it('handles tool execution error', async () => {
    const tool: CouncilTool<unknown> = {
      name: 'failing_tool',
      description: 'Always fails',
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('Tool execution failed');
      },
    };

    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'failing_tool', input: {} },
    ];

    const results = await executeTools(toolCalls, [tool], {}, {});

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toBeDefined();
    if (result) {
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Tool execution failed');
    }
  });

  it('passes member input and context to tool execute', async () => {
    const executeSpy = vi.fn().mockResolvedValue('done');
    const tool: CouncilTool<{ userId: number }> = {
      name: 'context_tool',
      description: 'Uses context',
      inputSchema: z.object({}),
      execute: executeSpy,
    };

    const memberInput = { userId: 42 };
    const context = { apiKey: 'secret' };
    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'context_tool', input: {} },
    ];

    await executeTools(toolCalls, [tool], memberInput, context);

    expect(executeSpy).toHaveBeenCalledWith({}, memberInput, context);
  });

  it('executes multiple tools in sequence', async () => {
    const executionOrder: string[] = [];

    const tool1: CouncilTool<unknown> = {
      name: 'tool1',
      description: 'First tool',
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push('tool1');
        return 'result1';
      },
    };

    const tool2: CouncilTool<unknown> = {
      name: 'tool2',
      description: 'Second tool',
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push('tool2');
        return 'result2';
      },
    };

    const toolCalls = [
      { type: 'tool_use' as const, id: 'call-1', name: 'tool1', input: {} },
      { type: 'tool_use' as const, id: 'call-2', name: 'tool2', input: {} },
    ];

    const results = await executeTools(toolCalls, [tool1, tool2], {}, {});

    expect(results).toHaveLength(2);
    const result0 = results[0];
    const result1 = results[1];
    expect(result0).toBeDefined();
    expect(result1).toBeDefined();
    if (result0 && result1) {
      expect(result0.content).toBe('result1');
      expect(result1.content).toBe('result2');
    }
    expect(executionOrder).toEqual(['tool1', 'tool2']);
  });
});
