import type { Octokit } from '@octokit/rest';

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
