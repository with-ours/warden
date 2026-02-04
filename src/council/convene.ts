import Anthropic from '@anthropic-ai/sdk';
import type { CouncilMember, ConveneOptions, Verdict } from './types.js';
import { extractJson } from './json.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TIMEOUT = 30000;

/**
 * Convene a council member to render judgment on the given input.
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

  const client = new Anthropic({ apiKey: options.apiKey, timeout });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

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
