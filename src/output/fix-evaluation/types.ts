import type { ExistingComment } from '../dedup.js';
import type { UsageStats } from '../../types/index.js';

/**
 * Result of evaluateFixAttempts - aggregated across all comments in a PR.
 * Includes accumulated usage stats from all council evaluations.
 */
export interface EvaluateFixAttemptsResult {
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
  /** Evaluations that failed and used fallback (API errors, invalid responses) */
  failedEvaluations: number;
  /** Accumulated usage stats from all fix evaluations */
  usage: UsageStats;
}

/**
 * Context for evaluateFixAttempts.
 */
export interface EvaluateFixAttemptsContext {
  owner: string;
  repo: string;
  previousSha: string;
  currentSha: string;
}
