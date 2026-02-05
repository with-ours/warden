import type { Octokit } from '@octokit/rest';
import type { ExistingComment } from './dedup.js';
import type { Finding, FileChange } from '../types/index.js';

/**
 * Scope of analyzed files in the PR.
 */
export interface AnalyzedScope {
  /** Set of file paths that were in the diff */
  files: Set<string>;
}

/**
 * Build the analyzed scope from file changes.
 */
export function buildAnalyzedScope(fileChanges: FileChange[]): AnalyzedScope {
  return {
    files: new Set(fileChanges.map((f) => f.filename)),
  };
}

/**
 * Check if a comment's file was in the analyzed scope.
 * Only comments on files that were analyzed should be considered for resolution.
 */
export function isInAnalyzedScope(comment: ExistingComment, scope: AnalyzedScope): boolean {
  return scope.files.has(comment.path);
}

/**
 * Find orphaned comments (comments on files no longer in scope).
 *
 * IMPORTANT: This function ONLY marks comments as stale when the file is orphaned
 * (no longer in the PR scope). It does NOT resolve comments based on missing findings.
 *
 * Resolution based on findings is handled by fix evaluation, which uses an LLM to
 * verify that a patch actually fixed the issue. This prevents incorrectly resolving
 * comments when:
 * - Non-deterministic LLM skills produce different findings on different runs
 * - A commit doesn't touch the file with the finding
 * - The underlying bug still exists but wasn't re-detected
 *
 * @param existingComments - Comments from previous Warden runs
 * @param _allFindings - Unused, kept for API compatibility
 * @param scope - Files currently in the PR scope
 */
export function findStaleComments(
  existingComments: ExistingComment[],
  _allFindings: Finding[],
  scope: AnalyzedScope
): ExistingComment[] {
  return existingComments.filter((comment) => {
    // Must have thread ID to resolve
    if (!comment.threadId) return false;
    // Already resolved, nothing to do
    if (comment.isResolved) return false;
    // Only orphaned comments (file no longer in scope) are stale
    return !isInAnalyzedScope(comment, scope);
  });
}

const RESOLVE_THREAD_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`;

/** Maximum stale comments to resolve per run (matches default maxFindings) */
const MAX_STALE_RESOLUTIONS = 50;

/**
 * Resolve stale comment threads via GraphQL.
 * Returns the number of threads successfully resolved.
 * Limited to MAX_STALE_RESOLUTIONS per run as a safeguard.
 */
export async function resolveStaleComments(
  octokit: Octokit,
  staleComments: ExistingComment[]
): Promise<number> {
  let resolvedCount = 0;

  const commentsToResolve = staleComments.slice(0, MAX_STALE_RESOLUTIONS);
  if (staleComments.length > MAX_STALE_RESOLUTIONS) {
    console.log(
      `Limiting stale comment resolution to ${MAX_STALE_RESOLUTIONS} of ${staleComments.length} comments`
    );
  }

  for (const comment of commentsToResolve) {
    if (!comment.threadId) {
      continue;
    }

    try {
      await octokit.graphql(RESOLVE_THREAD_MUTATION, {
        threadId: comment.threadId,
      });
      resolvedCount++;
    } catch (error) {
      const errorMessage = String(error);
      if (errorMessage.includes('Resource not accessible')) {
        // Permission error affects all threads; log once and stop trying
        console.warn(
          `Failed to resolve thread: GitHub App may need 'contents:write' permission. ` +
            `See: https://github.com/orgs/community/discussions/44650`
        );
        break;
      }
      console.warn(`Failed to resolve thread for comment ${comment.id}: ${error}`);
    }
  }

  return resolvedCount;
}
