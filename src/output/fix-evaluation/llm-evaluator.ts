import { conveneWithFallback, fixJudge } from '../../council/index.js';
import type { ExistingComment } from '../dedup.js';
import type { FixJudgeVerdict, FixJudgeContext, ConveneOptions, ConveneWithFallbackResult } from '../../council/index.js';

export type { FixJudgeVerdict, FixStatus } from '../../council/index.js';
export { fixJudge };

/**
 * Build a fix evaluation prompt for testing purposes.
 */
export function buildFixPrompt(
  comment: ExistingComment,
  changedFiles: string[],
  codeBeforeFix: string
): string {
  return fixJudge.buildPrompt({ comment, changedFiles, codeBeforeFix });
}

/**
 * Options for evaluating a fix.
 */
export interface EvaluateFixOptions {
  apiKey: string;
  toolContext?: FixJudgeContext;
}

/**
 * Input for fix evaluation.
 */
export interface FixEvaluationInput {
  comment: ExistingComment;
  changedFiles: string[];
  codeBeforeFix: string;
}

/**
 * Result of evaluating a fix, including the verdict and usage stats.
 */
export type FixEvaluationResult = ConveneWithFallbackResult<FixJudgeVerdict>;

/**
 * Evaluate the fix status by letting the judge explore the changes.
 * Returns the verdict (not_attempted, attempted_failed, or resolved) along with
 * usage stats accumulated across all API calls including tool iterations.
 */
export function evaluateFix(
  input: FixEvaluationInput,
  options: EvaluateFixOptions
): Promise<FixEvaluationResult> {
  const conveneOptions: ConveneOptions = {
    apiKey: options.apiKey,
    toolContext: options.toolContext,
  };

  return conveneWithFallback(
    fixJudge,
    input,
    conveneOptions,
    { status: 'not_attempted', reasoning: 'Evaluation failed' }
  );
}
