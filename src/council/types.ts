import type { z } from 'zod';
import type { UsageStats } from '../types/index.js';

/**
 * Context passed to tool execution.
 * Contains resources like GitHub client, repo info, SHAs, etc.
 */
export type ToolContext = Record<string, unknown>;

/**
 * A tool that a council member can invoke during deliberation.
 * Tools allow members to fetch additional context when needed.
 */
export interface CouncilTool<TInput> {
  /** Tool name (must match what's passed to the API) */
  name: string;
  /** Description of what the tool does (shown to the model) */
  description: string;
  /** Zod schema for tool input validation */
  inputSchema: z.ZodSchema;
  /** Execute the tool and return a string result */
  execute: (toolInput: unknown, memberInput: TInput, context: ToolContext) => Promise<string>;
}

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
  /** Optional tools the member can invoke */
  tools?: CouncilTool<TInput>[];
  /** Max tool iterations before giving up (default: 3) */
  maxToolIterations?: number;
  /** Optional prefill to force output format (e.g., "{" to force JSON) */
  prefill?: string;
}

/**
 * Result of convening a council member.
 * Includes usage stats aggregated across all API calls (including tool iterations).
 */
export type Verdict<T> =
  | { success: true; verdict: T; usage: UsageStats; debug?: ConveneDebugMetadata }
  | { success: false; error: string; usage?: UsageStats; debug?: ConveneDebugMetadata };

/**
 * Options for convening the council.
 */
export interface ConveneOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Override the model (default: claude-haiku-4-5) */
  model?: string;
  /** Context passed to tool execution */
  toolContext?: ToolContext;
  /** Enable debug logging for tool calls and iterations */
  debug?: boolean;
}

/**
 * Metadata about tool calls made during deliberation.
 * Useful for debugging and understanding judge behavior.
 */
export interface ToolCallMetadata {
  /** Tool name that was called */
  name: string;
  /** Input passed to the tool */
  input: unknown;
  /** Result returned by the tool */
  result: string;
  /** Whether the tool call resulted in an error */
  isError: boolean;
}

/**
 * Debug metadata returned with verdicts when debug mode is enabled.
 */
export interface ConveneDebugMetadata {
  /** Number of tool iterations used */
  toolIterations: number;
  /** Details of each tool call made */
  toolCalls: ToolCallMetadata[];
}
