import { fixJudge } from './fix-judge.js';
import { duplicateJudge } from './duplicate-judge.js';

export { fixJudge, duplicateJudge };
export type { FixJudgeInput, FixJudgeVerdict, FixStatus, FixJudgeContext } from './fix-judge.js';
export type { DuplicateJudgeInput, DuplicateJudgeVerdict } from './duplicate-judge.js';

/**
 * Registry of all council members.
 * Useful for introspection, documentation, and tooling.
 */
export const councilMembers = {
  fixJudge,
  duplicateJudge,
} as const;

/**
 * List all council members with their metadata.
 */
export function listCouncilMembers(): { name: string; description: string }[] {
  return Object.values(councilMembers).map((m) => ({
    name: m.name,
    description: m.description,
  }));
}
