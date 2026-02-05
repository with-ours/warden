import type { Octokit } from '@octokit/rest';
import type { ExistingComment } from '../dedup.js';
import { generateContentHash } from '../dedup.js';
import type { Finding, UsageStats } from '../../types/index.js';
import type { EvaluateFixAttemptsContext, EvaluateFixAttemptsResult } from './types.js';
import { evaluateFix } from './llm-evaluator.js';
import { fetchFollowUpChanges, fetchFileContent, formatFailedFixReply } from './github-actions.js';
import type { FixJudgeContext } from '../../council/index.js';

/**
 * Create empty usage stats for initialization.
 */
function emptyUsage(): UsageStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  };
}

/**
 * Add two usage stats together.
 */
function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens: (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0),
    costUSD: a.costUSD + b.costUSD,
  };
}

/** Maximum comments to evaluate per run */
const MAX_EVALUATIONS = 20;

/** Number of lines of context around the finding location */
const CONTEXT_LINES = 20;

/**
 * Extract numbered lines from content.
 */
function extractLines(content: string, start: number, end: number): string {
  const lines = content.split('\n');
  return lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join('\n');
}

/**
 * Fetch code snippet at a finding location at a specific commit.
 * Returns code with line numbers.
 *
 * Uses `currentLine` (GitHub's tracked position) when available to handle line drift.
 */
async function fetchCodeAtLocation(
  octokit: Octokit,
  owner: string,
  repo: string,
  comment: ExistingComment,
  sha: string,
  contextLines = CONTEXT_LINES
): Promise<string> {
  // Prefer currentLine (GitHub's tracked position) over line (original marker)
  const targetLine = comment.currentLine ?? comment.line;
  const startLine = Math.max(1, targetLine - contextLines);
  const endLine = targetLine + contextLines;

  try {
    const content = await fetchFileContent(octokit, owner, repo, comment.path, sha);
    return extractLines(content, startLine, endLine);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Not Found')) {
      return '(file does not exist at this commit)';
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
 * Evaluate fix attempts for all unresolved comments.
 *
 * Flow:
 * 1. Fetch patches between previous and current HEAD
 * 2. For each unresolved comment, let judge explore changes with tools
 * 3. Cross-check against current findings for re-detection
 * 4. Categorize into toResolve and toReply
 * 5. Accumulate usage stats from all evaluations
 */
export async function evaluateFixAttempts(
  octokit: Octokit,
  comments: ExistingComment[],
  context: EvaluateFixAttemptsContext,
  currentFindings: Finding[],
  apiKey: string
): Promise<EvaluateFixAttemptsResult> {
  const result: EvaluateFixAttemptsResult = {
    toResolve: [],
    toReply: [],
    skipped: 0,
    evaluated: 0,
    failedEvaluations: 0,
    usage: emptyUsage(),
  };

  // Filter to unresolved Warden comments only
  const unresolvedComments = comments.filter((c) => c.isWarden && !c.isResolved && c.threadId);

  if (unresolvedComments.length === 0) {
    return result;
  }

  // Fetch patches and commit messages from the follow-up commits
  // TODO: Consider using git directly for commit messages (git log --format="%s" base..head)
  // to avoid API calls. Would need to handle shallow clones gracefully (actions/checkout
  // defaults to depth=1). API approach works regardless of checkout configuration.
  const { patches, commitMessages } = await fetchFollowUpChanges(
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

  // Limit evaluations to avoid excessive API calls
  const commentsToEvaluate = unresolvedComments.slice(0, MAX_EVALUATIONS);

  if (unresolvedComments.length > MAX_EVALUATIONS) {
    result.skipped = unresolvedComments.length - MAX_EVALUATIONS;
    console.log(
      `Limiting fix evaluation to ${MAX_EVALUATIONS} of ${unresolvedComments.length} unresolved comments`
    );
  }

  // Build tool context for fix-judge (includes patches for get_file_diff tool)
  const toolContext: FixJudgeContext = {
    octokit,
    owner: context.owner,
    repo: context.repo,
    previousSha: context.previousSha,
    currentSha: context.currentSha,
    patches,
  };

  const changedFiles = [...patches.keys()];

  // Evaluate each comment, accumulating usage
  for (const comment of commentsToEvaluate) {
    result.evaluated++;

    // Fetch code at the issue location before this commit
    let codeBeforeFix: string;
    try {
      codeBeforeFix = await fetchCodeAtLocation(
        octokit,
        context.owner,
        context.repo,
        comment,
        context.previousSha
      );
    } catch (error) {
      console.warn(`Failed to fetch code for ${comment.path}:${comment.line}: ${error}`);
      continue;
    }

    // Fetch code after fix (optional, helps reduce tool calls)
    let codeAfterFix: string | undefined;
    try {
      codeAfterFix = await fetchCodeAtLocation(
        octokit,
        context.owner,
        context.repo,
        comment,
        context.currentSha
      );
    } catch {
      // Non-fatal: judge can still use tools to investigate
    }

    // Judge fix status - let it explore with tools
    const evalResult = await evaluateFix(
      { comment, changedFiles, codeBeforeFix, codeAfterFix, commitMessages },
      { apiKey, toolContext }
    );

    // Accumulate usage from this evaluation
    result.usage = addUsage(result.usage, evalResult.usage);

    // Track evaluation failures (API errors, invalid responses, etc.)
    if (evalResult.usedFallback) {
      result.failedEvaluations++;
      console.warn(
        `Fix evaluation failed for ${comment.path}:${comment.line} (${comment.title}), using fallback`
      );
      continue;
    }

    if (evalResult.verdict.status === 'not_attempted') {
      // Changes weren't related to this issue
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

    if (evalResult.verdict.status === 'resolved') {
      // Fix succeeded and issue not re-detected
      result.toResolve.push(comment);
    } else {
      // attempted_failed: fix attempted but didn't succeed
      result.toReply.push({
        comment,
        replyBody: formatFailedFixReply(context.currentSha, evalResult.verdict.reasoning),
        commitSha: context.currentSha,
      });
    }
  }

  return result;
}
