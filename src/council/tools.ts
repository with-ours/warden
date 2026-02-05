import type { ToolResultBlockParam, ToolUseBlock, Tool } from '@anthropic-ai/sdk/resources/messages';
import type { CouncilTool, ToolContext } from './types.js';

/**
 * Convert a Zod schema to JSON Schema for the Anthropic API.
 * Uses Zod v4's native toJSONSchema() method.
 */
export function convertToolSchema(
  schema: { toJSONSchema?: () => Record<string, unknown> }
): Tool['input_schema'] {
  if (typeof schema.toJSONSchema !== 'function') {
    throw new Error('Schema does not have toJSONSchema method - requires Zod v4');
  }
  const jsonSchema = schema.toJSONSchema();
  // Ensure we have the required type property for Anthropic API
  return jsonSchema as Tool['input_schema'];
}

/**
 * Convert council tools to Anthropic API tool format.
 */
export function convertToolsToApiFormat<TInput>(tools: CouncilTool<TInput>[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: convertToolSchema(tool.inputSchema),
  }));
}

/**
 * Extract tool use blocks from a response content array.
 */
export function extractToolUseBlocks(
  content: { type: string; id?: string; name?: string; input?: unknown }[]
): ToolUseBlock[] {
  return content.filter(
    (block): block is ToolUseBlock =>
      block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string'
  );
}

/**
 * Execute tool calls and return results for the next message.
 */
export async function executeTools<TInput>(
  toolCalls: ToolUseBlock[],
  tools: CouncilTool<TInput>[],
  memberInput: TInput,
  context: ToolContext
): Promise<ToolResultBlockParam[]> {
  const results: ToolResultBlockParam[] = [];

  for (const call of toolCalls) {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: `Unknown tool: ${call.name}`,
        is_error: true,
      });
      continue;
    }

    try {
      // Validate input against schema
      const parsed = tool.inputSchema.safeParse(call.input);
      if (!parsed.success) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Invalid tool input: ${parsed.error.message}`,
          is_error: true,
        });
        continue;
      }

      const result = await tool.execute(parsed.data, memberInput, context);
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: result,
      });
    } catch (error) {
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      });
    }
  }

  return results;
}
