import { conveneWithFallback, fixJudge, extractAndParseJson } from '../../council/index.js';
import type { ExistingComment } from '../dedup.js';
import type { FixJudgeVerdict, FixJudgeContext, ConveneOptions } from '../../council/index.js';

export type { FixJudgeVerdict, FixStatus } from '../../council/index.js';
export { fixJudge };

/**
 * Build a fix evaluation prompt for testing purposes.
 */
export function buildFixPrompt(
  comment: ExistingComment,
  beforeCode: string,
  afterCode: string
): string {
  return fixJudge.buildPrompt({ comment, beforeCode, afterCode });
}

/**
 * Parse an evaluation response from the LLM.
 * @deprecated Use convene() from council instead
 */
export function parseEvaluationResponse<T>(
  text: string,
  schema: { parse: (data: unknown) => T }
): T | null {
  const parsed = extractAndParseJson(text);
  if (!parsed) {
    return null;
  }

  try {
    return schema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Options for evaluating a fix.
 */
export interface EvaluateFixOptions {
  apiKey: string;
  toolContext?: FixJudgeContext;
}

/**
 * Evaluate the fix status by comparing before/after code against a comment.
 * Returns the status: not_attempted, attempted_failed, or resolved.
 */
export function evaluateFix(
  comment: ExistingComment,
  beforeCode: string,
  afterCode: string,
  options: EvaluateFixOptions
): Promise<FixJudgeVerdict> {
  const conveneOptions: ConveneOptions = {
    apiKey: options.apiKey,
    toolContext: options.toolContext,
  };

  return conveneWithFallback(
    fixJudge,
    { comment, beforeCode, afterCode },
    conveneOptions,
    { status: 'not_attempted', reasoning: 'Evaluation failed' }
  );
}
