import type { ExistingComment } from '../dedup.js';
import type { UsageStats } from '../../types/index.js';

/**
 * Aggregated result of evaluating fix attempts across all comments.
 * Includes accumulated usage stats from all council evaluations.
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
  /** Comments not evaluated (no patches, or over limit) */
  skipped: number;
  /** Comments sent to LLM for evaluation */
  evaluated: number;
  /** Accumulated usage stats from all fix evaluations */
  usage: UsageStats;
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
