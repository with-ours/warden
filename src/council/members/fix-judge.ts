import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { defineCouncilMember } from '../member.js';
import type { ExistingComment } from '../../output/dedup.js';
import type { CouncilTool, ToolContext } from '../types.js';
import { fetchFileLines } from '../../output/fix-evaluation/github-actions.js';

export interface FixJudgeInput {
  comment: ExistingComment;
  changedFiles: string[];
  codeBeforeFix: string;
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
  /** File patches for get_file_diff tool - maps file path to unified diff */
  patches?: Map<string, string>;
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

/**
 * Input schema for the get_file_diff tool.
 */
const GetFileDiffInputSchema = z.object({
  path: z.string().describe('File path to get diff for'),
});

/**
 * Tool to get the unified diff for a file.
 * Shows what changed between the two commits.
 */
const getFileDiff: CouncilTool<FixJudgeInput> = {
  name: 'get_file_diff',
  description: 'Get the unified diff showing what changed in a file between the two commits.',
  inputSchema: GetFileDiffInputSchema,
  execute: async (toolInput, _memberInput, context) => {
    const { path } = toolInput as z.infer<typeof GetFileDiffInputSchema>;
    const ctx = context as FixJudgeContext;
    const patch = ctx.patches?.get(path);
    return patch ?? 'No changes found for this file';
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

  buildPrompt: ({ comment, changedFiles, codeBeforeFix }) => `You are judging whether a code change fixed a specific issue that was reported in code review.

## The Original Report
**Title:** ${comment.title}
**Location:** ${comment.path} near line ${comment.line}

**Full comment (includes suggested fix if provided):**
${comment.description}

## Code at Issue Location (before this commit)
\`\`\`
${codeBeforeFix}
\`\`\`

## Files Changed in This Commit
${changedFiles.join('\n')}

## Your Task
Determine if these changes addressed the issue. Use tools to explore:
- get_file_diff(path): See what changed in a file
- get_file_at_commit(path, "before"|"after", startLine?, endLine?): See additional context

The fix may be at the original location, elsewhere in the file, or in a related file.
If a suggested fix was provided, check if it was applied (or an equivalent fix).

Return ONLY a JSON object: {"status": "not_attempted|attempted_failed|resolved", "reasoning": "brief explanation"}

Verdict meanings:
1. **not_attempted** - No changes related to this issue were made.
2. **attempted_failed** - Changes were made to address this issue but the fix is incorrect or incomplete.
3. **resolved** - The issue described is fixed.`,

  tools: [getFileDiff, getFileAtCommit],
  maxToolIterations: 5,
  schema: FixJudgeVerdictSchema,
});
