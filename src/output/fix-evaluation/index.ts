export type { FixEvaluationResult, FixEvaluationContext } from './types.js';

export {
  parsePatchHunks,
  didPatchTouchArea,
  findRelevantPatches,
  getPatchLineRange,
} from './patch-analysis.js';

export type { PatchHunk } from './patch-analysis.js';

export {
  buildFixPrompt,
  evaluateFix,
} from './llm-evaluator.js';

export type { FixJudgeVerdict, FixStatus } from './llm-evaluator.js';

export {
  fetchFollowUpPatches,
  fetchFileContent,
  fetchFileLines,
  postThreadReply,
  formatFailedFixReply,
} from './github-actions.js';

export type { EvaluateFixOptions } from './llm-evaluator.js';

export { evaluateFixAttempts } from './orchestrator.js';
