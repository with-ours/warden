import type { Octokit } from '@octokit/rest';

/**
 * Fetch file content at a specific commit SHA.
 * Returns the decoded file content as a string.
 */
export async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  sha: string
): Promise<string> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: sha,
  });

  // getContent returns array for directories, single object for files
  if (Array.isArray(data)) {
    throw new Error(`Path "${path}" is a directory, not a file`);
  }

  if (data.type !== 'file' || !data.content) {
    throw new Error(`Path "${path}" is not a file or content unavailable (file may be too large)`);
  }

  // Content is base64 encoded
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

/**
 * Fetch file content at a specific commit, returning lines in a range.
 * startLine and endLine are 1-indexed and inclusive.
 */
export async function fetchFileLines(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  startLine: number,
  endLine: number
): Promise<string> {
  const content = await fetchFileContent(octokit, owner, repo, path, sha);
  const lines = content.split('\n');
  const selectedLines = lines.slice(startLine - 1, endLine);
  return selectedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
}

/**
 * Result from fetching follow-up changes between two commits.
 */
export interface FollowUpChanges {
  /** Map of file path to patch content */
  patches: Map<string, string>;
  /** Commit messages from the follow-up commits (helps judge understand intent) */
  commitMessages: string[];
}

/**
 * Fetch the patches and commit messages between two commits (for follow-up commit analysis).
 * Returns patches and commit messages to help the judge understand developer intent.
 */
export async function fetchFollowUpChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<FollowUpChanges> {
  const patches = new Map<string, string>();
  const commitMessages: string[] = [];

  try {
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    });

    for (const file of data.files ?? []) {
      if (file.patch) {
        patches.set(file.filename, file.patch);
      }
    }

    // Extract commit messages (helps judge understand intent)
    for (const commit of data.commits ?? []) {
      if (commit.commit.message) {
        commitMessages.push(commit.commit.message);
      }
    }
  } catch (error) {
    console.warn(`Failed to fetch follow-up changes: ${error}`);
  }

  return { patches, commitMessages };
}

/**
 * Fetch the patches between two commits (for follow-up commit analysis).
 * Returns a map of file path to patch content.
 *
 * @deprecated Use fetchFollowUpChanges instead, which also returns commit messages.
 */
export async function fetchFollowUpPatches(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<Map<string, string>> {
  const { patches } = await fetchFollowUpChanges(octokit, owner, repo, baseSha, headSha);
  return patches;
}

const ADD_THREAD_REPLY_MUTATION = `
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $threadId,
      body: $body
    }) {
      comment {
        id
      }
    }
  }
`;

/**
 * Post a reply to a review thread.
 */
export async function postThreadReply(
  octokit: Octokit,
  threadId: string,
  body: string
): Promise<void> {
  try {
    await octokit.graphql(ADD_THREAD_REPLY_MUTATION, {
      threadId,
      body,
    });
  } catch (error) {
    console.warn(`Failed to post thread reply: ${error}`);
    throw error;
  }
}

/**
 * Format a reply for a failed fix attempt.
 */
export function formatFailedFixReply(commitSha: string, reasoning: string): string {
  const shortSha = commitSha.slice(0, 7);
  return `**Fix attempt detected** (commit ${shortSha})

${reasoning}

The original issue appears unresolved. Please review and try again.

<sub>Evaluated by Warden</sub>`;
}
