import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { CouncilMember, ConveneOptions, Verdict } from './types.js';
import { extractJson } from './json.js';
import { convertToolsToApiFormat, executeTools, extractToolUseBlocks } from './tools.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_TOOL_ITERATIONS = 3;

/**
 * Convene a council member to render judgment on the given input.
 * Supports tool use for members that define tools.
 */
export async function convene<TInput, TVerdict>(
  member: CouncilMember<TInput, TVerdict>,
  input: TInput,
  options: ConveneOptions
): Promise<Verdict<TVerdict>> {
  const prompt = member.buildPrompt(input);
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = member.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeout = member.timeout ?? DEFAULT_TIMEOUT;
  const maxToolIterations = member.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  const client = new Anthropic({ apiKey: options.apiKey, timeout });

  // Convert member tools to API format if present
  const apiTools = member.tools?.length ? convertToolsToApiFormat(member.tools) : undefined;

  const messages: MessageParam[] = [{ role: 'user', content: prompt }];

  try {
    let iterations = 0;

    while (iterations < maxToolIterations) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages,
        tools: apiTools,
      });

      // If no tool use, extract verdict and return
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        const content = response.content[0];
        if (!content || content.type !== 'text') {
          return { success: false, error: 'Empty response from model' };
        }

        const jsonText = extractJson(content.text);
        if (!jsonText) {
          return { success: false, error: 'No JSON found in response' };
        }

        const parsed = JSON.parse(jsonText);
        const validated = member.schema.safeParse(parsed);

        if (!validated.success) {
          return { success: false, error: `Invalid verdict: ${validated.error.message}` };
        }

        return { success: true, verdict: validated.data };
      }

      // Handle tool use
      if (response.stop_reason === 'tool_use' && member.tools) {
        const toolCalls = extractToolUseBlocks(response.content);

        if (toolCalls.length === 0) {
          return { success: false, error: 'Tool use indicated but no tool calls found' };
        }

        const toolResults = await executeTools(
          toolCalls,
          member.tools,
          input,
          options.toolContext ?? {}
        );

        // Add assistant response and tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        iterations++;
        continue;
      }

      // Unexpected stop reason
      return { success: false, error: `Unexpected stop reason: ${response.stop_reason}` };
    }

    return { success: false, error: 'Max tool iterations exceeded' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Council member '${member.name}' failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Convene a council member, returning a fallback verdict on failure.
 */
export async function conveneWithFallback<TInput, TVerdict>(
  member: CouncilMember<TInput, TVerdict>,
  input: TInput,
  options: ConveneOptions,
  fallback: TVerdict
): Promise<TVerdict> {
  const result = await convene(member, input, options);
  return result.success ? result.verdict : fallback;
}
