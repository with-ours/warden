import type { Octokit } from '@octokit/rest';
import type { ExistingComment } from '../dedup.js';
import { generateContentHash } from '../dedup.js';
import type { Finding } from '../../types/index.js';
import type { FixEvaluationContext, FixEvaluationResult } from './types.js';
import { findRelevantPatches } from './patch-analysis.js';
import { evaluateFix } from './llm-evaluator.js';
import {
  fetchFollowUpPatches,
  fetchFileContent,
  formatFailedFixReply,
} from './github-actions.js';
import type { FixJudgeContext } from '../../council/index.js';

/** Maximum comments to evaluate per run */
const MAX_EVALUATIONS = 20;

/** Number of lines of context around the finding location */
const CONTEXT_LINES = 10;

/**
 * Fetch code snippets at a finding location from both commits.
 * Returns before/after code with line numbers.
 */
async function fetchCodeSnippets(
  octokit: Octokit,
  owner: string,
  repo: string,
  comment: ExistingComment,
  previousSha: string,
  currentSha: string,
  contextLines = CONTEXT_LINES
): Promise<{ beforeCode: string; afterCode: string }> {
  const startLine = Math.max(1, comment.line - contextLines);
  const endLine = comment.line + contextLines;

  const extractLines = (content: string, start: number, end: number): string => {
    const lines = content.split('\n');
    return lines
      .slice(start - 1, end)
      .map((line, i) => `${start + i}: ${line}`)
      .join('\n');
  };

  try {
    const [beforeContent, afterContent] = await Promise.all([
      fetchFileContent(octokit, owner, repo, comment.path, previousSha),
      fetchFileContent(octokit, owner, repo, comment.path, currentSha),
    ]);

    return {
      beforeCode: extractLines(beforeContent, startLine, endLine),
      afterCode: extractLines(afterContent, startLine, endLine),
    };
  } catch (error) {
    // If file doesn't exist at one commit (new/deleted file), handle gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Not Found')) {
      // Try to fetch whichever commit has the file
      try {
        const afterContent = await fetchFileContent(
          octokit,
          owner,
          repo,
          comment.path,
          currentSha
        );
        return {
          beforeCode: '(file did not exist)',
          afterCode: extractLines(afterContent, startLine, endLine),
        };
      } catch {
        try {
          const beforeContent = await fetchFileContent(
            octokit,
            owner,
            repo,
            comment.path,
            previousSha
          );
          return {
            beforeCode: extractLines(beforeContent, startLine, endLine),
            afterCode: '(file was deleted)',
          };
        } catch {
          throw new Error(`File "${comment.path}" not found at either commit`);
        }
      }
    }

    throw error;
  }
}

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

  // Build tool context for fix-judge
  const toolContext: FixJudgeContext = {
    octokit,
    owner: context.owner,
    repo: context.repo,
    previousSha: context.previousSha,
    currentSha: context.currentSha,
  };

  // Evaluate each comment
  for (const comment of commentsToEvaluate) {
    if (!relevantPatches.has(comment.id)) {
      continue;
    }

    result.evaluated++;

    // Fetch code snippets at the finding location
    let beforeCode: string;
    let afterCode: string;
    try {
      const snippets = await fetchCodeSnippets(
        octokit,
        context.owner,
        context.repo,
        comment,
        context.previousSha,
        context.currentSha
      );
      beforeCode = snippets.beforeCode;
      afterCode = snippets.afterCode;
    } catch (error) {
      console.warn(`Failed to fetch code snippets for ${comment.path}:${comment.line}: ${error}`);
      continue;
    }

    // Judge fix status
    const verdict = await evaluateFix(comment, beforeCode, afterCode, {
      apiKey,
      toolContext,
    });

    if (verdict.status === 'not_attempted') {
      // Code touched the area but wasn't attempting to fix this issue
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
