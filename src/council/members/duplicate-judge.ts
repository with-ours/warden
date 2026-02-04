import { z } from 'zod';
import { defineCouncilMember } from '../member.js';
import type { Finding } from '../../types/index.js';
import type { ExistingComment } from '../../output/dedup.js';

export interface DuplicateJudgeInput {
  findings: Finding[];
  existingComments: ExistingComment[];
}

export const DuplicateJudgeVerdictSchema = z.array(
  z.object({
    findingIndex: z.number().int(),
    existingIndex: z.number().int(),
  })
);

export type DuplicateJudgeVerdict = z.infer<typeof DuplicateJudgeVerdictSchema>;

function formatExistingComment(c: ExistingComment, i: number): string {
  return `${i + 1}. [${c.path}:${c.line}] "${c.title}" - ${c.description}`;
}

function formatFinding(f: Finding, i: number): string {
  const line = f.location?.endLine ?? f.location?.startLine;
  const loc = f.location ? `${f.location.path}:${line}` : 'general';
  return `${i + 1}. [${loc}] "${f.title}" - ${f.description}`;
}

/**
 * Judges whether new findings are duplicates of existing comments.
 */
export const duplicateJudge = defineCouncilMember<DuplicateJudgeInput, DuplicateJudgeVerdict>({
  name: 'duplicate-judge',
  description: 'Judges whether new findings are duplicates of existing comments',

  buildPrompt: ({ findings, existingComments }) => {
    const existingList = existingComments.map(formatExistingComment).join('\n');
    const findingsList = findings.map(formatFinding).join('\n');

    return `Compare these code review findings and identify duplicates.

Existing comments:
${existingList}

New findings:
${findingsList}

Return a JSON array of objects identifying which findings are DUPLICATES of which existing comments.
Only mark as duplicate if they describe the SAME issue at the SAME location (within a few lines).
Different issues at the same location are NOT duplicates.

Return ONLY the JSON array in this format:
[{"findingIndex": 1, "existingIndex": 2}]
where findingIndex is the 1-based index of the new finding and existingIndex is the 1-based index of the matching existing comment.
Return [] if none are duplicates.`;
  },

  schema: DuplicateJudgeVerdictSchema,
});
