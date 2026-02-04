import { z } from 'zod';
import { defineCouncilMember } from '../member.js';
import type { ExistingComment } from '../../output/dedup.js';

export interface FixJudgeInput {
  comment: ExistingComment;
  patch: string;
}

export const FixStatusSchema = z.enum(['not_attempted', 'attempted_failed', 'resolved']);
export type FixStatus = z.infer<typeof FixStatusSchema>;

export const FixJudgeVerdictSchema = z.object({
  status: FixStatusSchema,
  reasoning: z.string(),
});

export type FixJudgeVerdict = z.infer<typeof FixJudgeVerdictSchema>;

/**
 * Judges whether a patch addressed a reported issue and if so, whether successfully.
 */
export const fixJudge = defineCouncilMember<FixJudgeInput, FixJudgeVerdict>({
  name: 'fix-judge',
  description: 'Judges whether a patch addressed a reported issue and if the fix succeeded',

  buildPrompt: ({ comment, patch }) => `You are judging whether a code change addressed a code review finding.

## Original Finding
**Title:** ${comment.title}
**Description:** ${comment.description}
**Location:** ${comment.path}:${comment.line}

## Code Change (Patch)
\`\`\`diff
${patch}
\`\`\`

## Task
Determine the status of this fix:

1. **not_attempted** - The patch does not attempt to address this finding. The changes are unrelated or incidental.
2. **attempted_failed** - The patch tries to fix the issue but the fix is incorrect, incomplete, or could introduce new problems.
3. **resolved** - The patch correctly and completely addresses the finding.

Consider:
- Does the change target the issue described?
- If attempting a fix, is it correct and complete?
- Could the fix introduce new problems or edge cases?

Return ONLY a JSON object in this exact format:
{"status": "not_attempted|attempted_failed|resolved", "reasoning": "brief explanation"}`,

  schema: FixJudgeVerdictSchema,
});
