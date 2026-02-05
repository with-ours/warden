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
 * Fetch the patches between two commits (for follow-up commit analysis).
 * Returns a map of file path to patch content.
 */
export async function fetchFollowUpPatches(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<Map<string, string>> {
  const patches = new Map<string, string>();

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
  } catch (error) {
    console.warn(`Failed to fetch follow-up patches: ${error}`);
  }

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
