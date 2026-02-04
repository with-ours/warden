import type { z } from 'zod';

/**
 * A council member renders judgment on a specific type of question.
 * Each member has expertise in their domain and returns structured verdicts.
 */
export interface CouncilMember<TInput, TVerdict> {
  /** Unique identifier for this council member */
  name: string;
  /** What this member evaluates */
  description: string;
  /** Build the prompt from input */
  buildPrompt: (input: TInput) => string;
  /** Schema for parsing the verdict */
  schema: z.ZodSchema<TVerdict>;
  /** Max tokens for response (default: 512) */
  maxTokens?: number;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Result of convening a council member.
 */
export type Verdict<T> =
  | { success: true; verdict: T }
  | { success: false; error: string };

/**
 * Options for convening the council.
 */
export interface ConveneOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Override the model (default: claude-haiku-4-5) */
  model?: string;
}
