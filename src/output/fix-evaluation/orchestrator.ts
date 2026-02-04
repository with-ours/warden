import type { Octokit } from '@octokit/rest';
import type { ExistingComment } from '../dedup.js';
import { generateContentHash } from '../dedup.js';
import type { Finding } from '../../types/index.js';
import type { FixEvaluationContext, FixEvaluationResult } from './types.js';
import { findRelevantPatches } from './patch-analysis.js';
import { evaluateFix } from './llm-evaluator.js';
import { fetchFollowUpPatches, formatFailedFixReply } from './github-actions.js';

/** Maximum comments to evaluate per run */
const MAX_EVALUATIONS = 20;

/**
 * Check if a finding matches a comment (same location and similar content).
 * Mirrors the logic in stale.ts for consistency.
 */
function findingMatchesComment(finding: Finding, comment: ExistingComment): boolean {
  if (!finding.location) {
    return false;
  }

  if (finding.location.path !== comment.path) {
    return false;
  }

  const findingLine = finding.location.endLine ?? finding.location.startLine;
  const lineDiff = Math.abs(findingLine - comment.line);
  if (lineDiff > 5) {
    return false;
  }

  const findingHash = generateContentHash(finding.title, finding.description);
  if (findingHash === comment.contentHash) {
    return true;
  }

  const normalizedFindingTitle = finding.title.toLowerCase().trim();
  const normalizedCommentTitle = comment.title.toLowerCase().trim();
  return normalizedFindingTitle === normalizedCommentTitle;
}

/**
 * Check if an issue was re-detected in the current findings.
 */
function wasReDetected(comment: ExistingComment, currentFindings: Finding[]): boolean {
  return currentFindings.some((finding) => findingMatchesComment(finding, comment));
}

/**
 * Evaluate fix attempts for comments with follow-up patches.
 *
 * Flow:
 * 1. Fetch patches between previous and current HEAD
 * 2. Filter comments to those touched by patches
 * 3. For each touched comment, judge fix status (single LLM call)
 * 4. Cross-check against current findings for re-detection
 * 5. Categorize into toResolve and toReply
 */
export async function evaluateFixAttempts(
  octokit: Octokit,
  comments: ExistingComment[],
  context: FixEvaluationContext,
  currentFindings: Finding[],
  apiKey: string
): Promise<FixEvaluationResult> {
  const result: FixEvaluationResult = {
    toResolve: [],
    toReply: [],
    skipped: 0,
    evaluated: 0,
  };

  // Filter to unresolved Warden comments only
  const unresolvedComments = comments.filter(
    (c) => c.isWarden && !c.isResolved && c.threadId
  );

  if (unresolvedComments.length === 0) {
    return result;
  }

  // Fetch patches from the follow-up commit
  const patches = await fetchFollowUpPatches(
    octokit,
    context.owner,
    context.repo,
    context.previousSha,
    context.currentSha
  );

  if (patches.size === 0) {
    result.skipped = unresolvedComments.length;
    return result;
  }

  // Find comments that have relevant patches
  const relevantPatches = findRelevantPatches(patches, unresolvedComments);

  // Track comments not touched by patches
  result.skipped = unresolvedComments.length - relevantPatches.size;

  // Limit evaluations to avoid excessive API calls
  const commentsToEvaluate = unresolvedComments
    .filter((c) => relevantPatches.has(c.id))
    .slice(0, MAX_EVALUATIONS);

  if (relevantPatches.size > MAX_EVALUATIONS) {
    console.log(
      `Limiting fix evaluation to ${MAX_EVALUATIONS} of ${relevantPatches.size} touched comments`
    );
  }

  // Evaluate each comment
  for (const comment of commentsToEvaluate) {
    const patch = relevantPatches.get(comment.id);
    if (!patch) {
      continue;
    }

    result.evaluated++;

    // Judge fix status in a single call
    const verdict = await evaluateFix(comment, patch, apiKey);

    if (verdict.status === 'not_attempted') {
      // Patch touched the area but wasn't attempting to fix this issue
      continue;
    }

    // Check if the issue was re-detected (overrides LLM judgment)
    const reDetected = wasReDetected(comment, currentFindings);

    if (reDetected) {
      // Issue was re-detected, fix didn't work regardless of LLM opinion
      result.toReply.push({
        comment,
        replyBody: formatFailedFixReply(
          context.currentSha,
          'The fix attempt was made, but the same issue was detected again in the updated code.'
        ),
        commitSha: context.currentSha,
      });
      continue;
    }

    if (verdict.status === 'resolved') {
      // Fix succeeded and issue not re-detected
      result.toResolve.push(comment);
    } else {
      // attempted_failed: fix attempted but didn't succeed
      result.toReply.push({
        comment,
        replyBody: formatFailedFixReply(context.currentSha, verdict.reasoning),
        commitSha: context.currentSha,
      });
    }
  }

  return result;
}
