import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { CouncilMember, ConveneOptions, Verdict } from './types.js';
import type { UsageStats } from '../types/index.js';
import { extractJson } from './json.js';
import { convertToolsToApiFormat, executeTools, extractToolUseBlocks } from './tools.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_TOOL_ITERATIONS = 3;

/** Cost per million tokens for Claude Haiku 4.5 (as of 2024) */
const HAIKU_COST_PER_M_INPUT = 0.80;
const HAIKU_COST_PER_M_OUTPUT = 4.00;

/**
 * Create empty usage stats for initialization.
 */
function emptyUsage(): UsageStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  };
}

/**
 * Calculate cost from token counts.
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * HAIKU_COST_PER_M_INPUT +
         (outputTokens / 1_000_000) * HAIKU_COST_PER_M_OUTPUT;
}

/**
 * Add usage from an API response to accumulated usage.
 */
function accumulateUsage(
  accumulated: UsageStats,
  response: { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }
): UsageStats {
  const inputTokens = accumulated.inputTokens + response.usage.input_tokens;
  const outputTokens = accumulated.outputTokens + response.usage.output_tokens;
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: (accumulated.cacheReadInputTokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens: (accumulated.cacheCreationInputTokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
    costUSD: calculateCost(inputTokens, outputTokens),
  };
}

/**
 * Convene a council member to render judgment on the given input.
 * Supports tool use for members that define tools.
 *
 * Usage stats are accumulated across all API calls, including tool iterations,
 * and returned with the verdict for cost tracking.
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

  // Track usage across all iterations
  let totalUsage = emptyUsage();

  try {
    let iterations = 0;

    while (iterations < maxToolIterations) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages,
        tools: apiTools,
      });

      // Accumulate usage from this API call
      totalUsage = accumulateUsage(totalUsage, response);

      // If no tool use, extract verdict and return
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        const content = response.content[0];
        if (!content || content.type !== 'text') {
          return { success: false, error: 'Empty response from model', usage: totalUsage };
        }

        const jsonText = extractJson(content.text);
        if (!jsonText) {
          return { success: false, error: 'No JSON found in response', usage: totalUsage };
        }

        const parsed = JSON.parse(jsonText);
        const validated = member.schema.safeParse(parsed);

        if (!validated.success) {
          return { success: false, error: `Invalid verdict: ${validated.error.message}`, usage: totalUsage };
        }

        return { success: true, verdict: validated.data, usage: totalUsage };
      }

      // Handle tool use
      if (response.stop_reason === 'tool_use' && member.tools) {
        const toolCalls = extractToolUseBlocks(response.content);

        if (toolCalls.length === 0) {
          return { success: false, error: 'Tool use indicated but no tool calls found', usage: totalUsage };
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
      return { success: false, error: `Unexpected stop reason: ${response.stop_reason}`, usage: totalUsage };
    }

    return { success: false, error: 'Max tool iterations exceeded', usage: totalUsage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Council member '${member.name}' failed: ${message}`);
    return { success: false, error: message, usage: totalUsage };
  }
}

/**
 * Result from conveneWithFallback, including the verdict and accumulated usage.
 */
export interface ConveneWithFallbackResult<TVerdict> {
  verdict: TVerdict;
  usage: UsageStats;
  /** Whether the fallback was used (true = council failed) */
  usedFallback: boolean;
}

/**
 * Convene a council member, returning a fallback verdict on failure.
 * Always returns usage stats (may be partial if call failed mid-way).
 */
export async function conveneWithFallback<TInput, TVerdict>(
  member: CouncilMember<TInput, TVerdict>,
  input: TInput,
  options: ConveneOptions,
  fallback: TVerdict
): Promise<ConveneWithFallbackResult<TVerdict>> {
  const result = await convene(member, input, options);
  if (result.success) {
    return { verdict: result.verdict, usage: result.usage, usedFallback: false };
  }
  return { verdict: fallback, usage: result.usage ?? emptyUsage(), usedFallback: true };
}
