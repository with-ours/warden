import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { UsageStats } from '../types/index.js';
import { Sentry } from '../sentry.js';
import { apiUsageToStats } from './pricing.js';
import { emptyUsage } from './usage.js';
import { extractJson, setGenAiResponseAttrs, DEFAULT_AUXILIARY_MAX_RETRIES } from './haiku.js';

export const SONNET_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Result from a structured Sonnet call.
 */
export type SonnetResult<T> =
  | { success: true; data: T; usage: UsageStats }
  | { success: false; error: string; usage: UsageStats };

/**
 * Options for callSonnet.
 */
export interface CallSonnetOptions<T> {
  apiKey: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Infer prefill character from schema type to force JSON output.
 */
function inferPrefill(schema: z.ZodType): string | undefined {
  if ('_def' in schema && (schema as { _def: { typeName?: string } })._def.typeName === 'ZodObject') return '{';
  if ('_def' in schema && (schema as { _def: { typeName?: string } })._def.typeName === 'ZodArray') return '[';
  return undefined;
}

/**
 * Single-turn structured Sonnet call.
 * Auto-prefills based on Zod schema type, extracts JSON, validates with Zod.
 */
export async function callSonnet<T>(options: CallSonnetOptions<T>): Promise<SonnetResult<T>> {
  const { apiKey, prompt, schema, maxTokens = DEFAULT_MAX_TOKENS, timeout = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_AUXILIARY_MAX_RETRIES } = options;

  return Sentry.startSpan(
    {
      op: 'gen_ai.chat',
      name: `chat ${SONNET_MODEL}`,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'anthropic',
        'gen_ai.request.model': SONNET_MODEL,
        'gen_ai.request.max_tokens': maxTokens,
      },
    },
    async (span) => {
      const client = new Anthropic({ apiKey, timeout, maxRetries });
      const prefill = inferPrefill(schema);

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: prompt },
      ];
      if (prefill) {
        messages.push({ role: 'assistant', content: prefill });
      }

      span.setAttribute('gen_ai.request.messages', JSON.stringify(messages));

      try {
        const response = await client.messages.create({
          model: SONNET_MODEL,
          max_tokens: maxTokens,
          messages,
        });

        const usage = apiUsageToStats(SONNET_MODEL, response.usage);

        const content = response.content[0];
        if (!content || content.type !== 'text') {
          setGenAiResponseAttrs(span, response.usage, response.stop_reason);
          return { success: false, error: 'Empty response from model', usage };
        }

        let fullText = content.text;
        if (prefill) {
          fullText = prefill + fullText;
        }
        setGenAiResponseAttrs(span, response.usage, response.stop_reason, fullText);
        const jsonStr = extractJson(fullText);
        if (!jsonStr) {
          return { success: false, error: 'No JSON found in response', usage };
        }

        const parsed = JSON.parse(jsonStr);
        const validated = schema.safeParse(parsed);

        if (!validated.success) {
          return { success: false, error: `Validation failed: ${validated.error.message}`, usage };
        }

        return { success: true, data: validated.data, usage };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, usage: emptyUsage() };
      }
    },
  );
}
