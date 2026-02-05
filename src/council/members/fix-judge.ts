import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { defineCouncilMember } from '../member.js';
import type { ExistingComment } from '../../output/dedup.js';
import type { CouncilTool, ToolContext } from '../types.js';
import { fetchFileLines } from '../../output/fix-evaluation/github-actions.js';

export interface FixJudgeInput {
  comment: ExistingComment;
  beforeCode: string;
  afterCode: string;
}

/**
 * Context required for fix-judge tool execution.
 */
export interface FixJudgeContext extends ToolContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  previousSha: string;
  currentSha: string;
}

/**
 * Input schema for the get_file_at_commit tool.
 */
const GetFileAtCommitInputSchema = z.object({
  path: z.string().describe('File path to fetch'),
  commit: z.enum(['before', 'after']).describe('before = pre-fix commit, after = post-fix commit'),
  startLine: z.number().optional().describe('Start line (1-indexed, inclusive)'),
  endLine: z.number().optional().describe('End line (1-indexed, inclusive)'),
});

/**
 * Tool to fetch file content at a specific commit.
 * Allows the judge to explore additional context when needed.
 */
const getFileAtCommit: CouncilTool<FixJudgeInput> = {
  name: 'get_file_at_commit',
  description:
    'Get file content at a specific commit. Use "before" for the state before the fix attempt, "after" for the state after. Optionally specify line range to get a specific section.',
  inputSchema: GetFileAtCommitInputSchema,
  execute: async (toolInput, _memberInput, context) => {
    const { path, commit, startLine, endLine } = toolInput as z.infer<
      typeof GetFileAtCommitInputSchema
    >;
    const ctx = context as FixJudgeContext;

    if (!ctx.octokit || !ctx.owner || !ctx.repo) {
      return 'Error: GitHub context not available';
    }

    const sha = commit === 'before' ? ctx.previousSha : ctx.currentSha;

    try {
      if (startLine !== undefined && endLine !== undefined) {
        return await fetchFileLines(ctx.octokit, ctx.owner, ctx.repo, path, sha, startLine, endLine);
      }

      // Fetch full file but limit output
      const { fetchFileContent } = await import('../../output/fix-evaluation/github-actions.js');
      const content = await fetchFileContent(ctx.octokit, ctx.owner, ctx.repo, path, sha);
      const lines = content.split('\n');

      // Limit to 100 lines to avoid overwhelming context
      if (lines.length > 100) {
        const numbered = lines.slice(0, 100).map((line, i) => `${i + 1}: ${line}`);
        return `${numbered.join('\n')}\n\n[... ${lines.length - 100} more lines truncated]`;
      }

      return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    } catch (error) {
      return `Error fetching file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const FixStatusSchema = z.enum(['not_attempted', 'attempted_failed', 'resolved']);
export type FixStatus = z.infer<typeof FixStatusSchema>;

export const FixJudgeVerdictSchema = z.object({
  status: FixStatusSchema,
  reasoning: z.string(),
});

export type FixJudgeVerdict = z.infer<typeof FixJudgeVerdictSchema>;

/**
 * Judges whether a code change addressed a reported issue and if so, whether successfully.
 */
export const fixJudge = defineCouncilMember<FixJudgeInput, FixJudgeVerdict>({
  name: 'fix-judge',
  description: 'Judges whether a code change addressed a reported issue and if the fix succeeded',

  buildPrompt: ({ comment, beforeCode, afterCode }) => `You are judging whether a code change addressed a code review finding.

## Original Finding
**Title:** ${comment.title}
**Description:** ${comment.description}
**Location:** ${comment.path}:${comment.line}

## Code BEFORE This Commit
\`\`\`
${beforeCode}
\`\`\`

## Code AFTER This Commit
\`\`\`
${afterCode}
\`\`\`

## Task
Determine if this change addresses the finding:

1. **not_attempted** - The code is unchanged or changes are unrelated to the finding.
2. **attempted_failed** - An attempt was made but the fix is incorrect or incomplete.
3. **resolved** - The finding is correctly addressed.

If you need additional context (imports, related functions, etc.), use the get_file_at_commit tool.

Return ONLY a JSON object in this exact format:
{"status": "not_attempted|attempted_failed|resolved", "reasoning": "brief explanation"}`,

  tools: [getFileAtCommit],
  maxToolIterations: 2,
  schema: FixJudgeVerdictSchema,
});
