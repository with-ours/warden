// Types
export type {
  ExpectedBug,
  Fixture,
  LoadedFixture,
  JudgeResult,
  MatchOutcome,
  SpuriousFinding,
  FixtureResult,
  EvalMetrics,
  RunResult,
  EvalResult,
} from './types.js';

export {
  ExpectedBugSchema,
  FixtureSchema,
  JudgeResultSchema,
} from './types.js';

// Loader
export {
  getEvalsDir,
  getEvalSkillsDir,
  discoverFixtures,
  loadFixture,
  getFixtureFiles,
  loadFixtureWithFiles,
  discoverAndLoadFixtures,
  discoverSkills,
  loadSkillFixtures,
} from './loader.js';
export type { DiscoverOptions, SkillFixtures } from './loader.js';

// Judge
export {
  judgeFinding,
  findCandidateFinding,
  createFindingTracker,
} from './judge.js';

// Metrics
export {
  calculateMetrics,
  aggregateFixtureMetrics,
  aggregateRunMetrics,
} from './metrics.js';
export type { AggregatedMetrics } from './metrics.js';

// Runner
export { runEval, evaluateFixture } from './runner.js';
export type { EvalRunnerCallbacks, EvalRunnerOptions, RunEvalOptions } from './runner.js';

// Task (for evalite)
export { runFixtureTask } from './task.js';
export type { TaskOutput } from './task.js';

// Scorers (for evalite)
export { PresenceScorer, AccuracyScorer } from './scorers.js';
