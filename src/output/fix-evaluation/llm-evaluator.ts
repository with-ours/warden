import { conveneWithFallback, fixJudge, extractAndParseJson } from '../../council/index.js';
import type { ExistingComment } from '../dedup.js';
import type { FixJudgeVerdict } from '../../council/index.js';

export type { FixJudgeVerdict, FixStatus } from '../../council/index.js';
export { fixJudge };

/**
 * Build a fix evaluation prompt for testing purposes.
 */
export function buildFixPrompt(comment: ExistingComment, patch: string): string {
  return fixJudge.buildPrompt({ comment, patch });
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
 * Evaluate the fix status of a patch against a comment.
 * Returns the status: not_attempted, attempted_failed, or resolved.
 */
export function evaluateFix(
  comment: ExistingComment,
  patch: string,
  apiKey: string
): Promise<FixJudgeVerdict> {
  return conveneWithFallback(
    fixJudge,
    { comment, patch },
    { apiKey },
    { status: 'not_attempted', reasoning: 'Evaluation failed' }
  );
}
