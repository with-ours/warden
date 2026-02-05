import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { defineCouncilMember } from '../member.js';
import type { ExistingComment } from '../../output/dedup.js';
import type { CouncilTool, ToolContext } from '../types.js';
import { fetchFileLines, fetchFileContent } from '../../output/fix-evaluation/github-actions.js';

export interface FixJudgeInput {
  comment: ExistingComment;
  changedFiles: string[];
  codeBeforeFix: string;
  /** Code at the issue location after the fix attempt (optional, reduces tool calls) */
  codeAfterFix?: string;
  /** Commit messages from the follow-up commits (helps judge understand intent) */
  commitMessages?: string[];
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

  buildPrompt: ({ comment, changedFiles, codeBeforeFix, codeAfterFix, commitMessages }) => {
    const afterCodeSection = codeAfterFix
      ? `

## Code at Issue Location (AFTER this commit)
\`\`\`
${codeAfterFix}
\`\`\``
      : '';

    const commitMessagesSection = commitMessages && commitMessages.length > 0
      ? `

## Commit Messages (Developer Intent)
${commitMessages.map((msg, i) => `${i + 1}. ${msg.split('\n')[0]}`).join('\n')}

Use these to help understand what the developer was trying to do. A commit mentioning "fix" or the issue topic suggests intent to address it.`
      : '';

    const investigationStrategy = codeAfterFix
      ? `## Investigation Strategy

Compare the BEFORE and AFTER code above to determine if the issue was fixed.
Use tools only if you need additional context:

- \`get_file_diff(path)\` - See unified diff of changes to a file
- \`get_file_at_commit(path, "before"|"after", startLine?, endLine?)\` - Read more file content if needed`
      : `## Investigation Strategy

Use tools to determine if the issue was fixed:

1. **Start with get_file_diff** on the issue's file (if changed) to see what was modified
2. **Use get_file_at_commit with "after"** to see the current state at the issue location
3. **Check related files** if the fix might involve changes elsewhere (imports, shared utilities, etc.)

Tools:
- \`get_file_diff(path)\` - See unified diff of changes to a file
- \`get_file_at_commit(path, "before"|"after", startLine?, endLine?)\` - Read file content at either commit`;

    return `# Task: Judge whether a code change fixed a reported issue

**Key Question: Does the reported issue still exist in the code after this commit?**

## Verdict Definitions

Choose ONE verdict based on these criteria:

**resolved** - The issue NO LONGER EXISTS. Evidence:
- The problematic code was corrected (directly or via equivalent fix)
- The code was refactored in a way that eliminates the issue by design
- The problematic code was intentionally removed (file deleted, function removed, dead code cleaned up)

**attempted_failed** - A fix was CLEARLY ATTEMPTED but the issue PERSISTS. Evidence:
- Changes DIRECTLY modify the reported file at or near the issue location
- AND the changes appear specifically intended to address THIS issue
- BUT the core issue remains (wrong fix, incomplete fix, edge cases missed)
- Use this ONLY when there's clear evidence of intent to fix THIS specific issue
- Do NOT use for general refactoring, unrelated bug fixes, or changes to other files
- When in doubt between attempted_failed and not_attempted, prefer not_attempted

**not_attempted** - The issue was NOT ADDRESSED. Evidence:
- No changes to the problematic code or its logic
- Changes are unrelated (different feature, different bug, unrelated refactor)
- The reported code is identical or functionally unchanged
- Changes are in other files with no clear connection to the reported issue

## The Reported Issue

**Title:** ${comment.title}
**File:** ${comment.path}
**Line:** ${comment.line}

**Description:**
${comment.description}

## Code at Issue Location (BEFORE this commit)
\`\`\`
${codeBeforeFix}
\`\`\`
${afterCodeSection}

## Changed Files in This Commit
${changedFiles.map((f) => `- ${f}`).join('\n')}
${commitMessagesSection}

${investigationStrategy}

## Response Format

IMPORTANT: Your response must be ONLY a JSON object with no other text. Do not explain your reasoning in prose - put your one-sentence explanation in the "reasoning" field.

{"status": "resolved|attempted_failed|not_attempted", "reasoning": "One sentence explaining your verdict"}`;
  },

  tools: [getFileDiff, getFileAtCommit],
  maxToolIterations: 5,
  schema: FixJudgeVerdictSchema,
});
