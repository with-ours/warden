import type { ExistingComment } from '../dedup.js';

/**
 * Aggregated result of evaluating fix attempts across all comments.
 */
export interface FixEvaluationResult {
  /** Comments where fix was successful and should be resolved */
  toResolve: ExistingComment[];
  /** Comments where fix failed and need a reply */
  toReply: {
    comment: ExistingComment;
    replyBody: string;
    commitSha: string;
  }[];
  /** Comments not touched by patches (no fix attempted) */
  skipped: number;
  /** Comments sent to LLM for evaluation */
  evaluated: number;
}

/**
 * Context for fix evaluation.
 */
export interface FixEvaluationContext {
  owner: string;
  repo: string;
  previousSha: string;
  currentSha: string;
}
