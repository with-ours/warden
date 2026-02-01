import { z } from 'zod';
import { SeveritySchema, ConfidenceSchema } from '../types/index.js';

// Expected bug definition in _fixture.json
export const ExpectedBugSchema = z.object({
  id: z.string(),
  file: z.string(),
  bug: z.string(),
  severity: SeveritySchema.optional(),
  line: z.number().int().positive().optional(),
});
export type ExpectedBug = z.infer<typeof ExpectedBugSchema>;

// Fixture metadata schema
export const FixtureSchema = z.object({
  skill: z.string(),
  description: z.string(),
  expectedBugs: z.array(ExpectedBugSchema),
  tags: z.array(z.string()).optional(),
  skip: z.string().optional(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

// Loaded fixture with path information
export interface LoadedFixture {
  path: string;
  name: string;
  fixture: Fixture;
  files: string[];
}

// Judge result from LLM-as-judge
export const JudgeResultSchema = z.object({
  matches: z.boolean(),
  confidence: ConfidenceSchema,
  reasoning: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

// Match outcome for a single expected bug
export interface MatchOutcome {
  expectedBug: ExpectedBug;
  finding: {
    id: string;
    title: string;
    description: string;
    severity: string;
    file?: string;
    line?: number;
  } | null;
  judgeResult: JudgeResult | null;
  outcome: 'true_positive' | 'false_negative';
}

// Spurious finding (false positive)
export interface SpuriousFinding {
  finding: {
    id: string;
    title: string;
    description: string;
    severity: string;
    file?: string;
    line?: number;
  };
}

// Result for a single fixture
export interface FixtureResult {
  fixture: string;
  skill: string;
  description: string;
  expectedBugs: number;
  found: number;
  missed: number;
  spurious: number;
  matchOutcomes: MatchOutcome[];
  spuriousFindings: SpuriousFinding[];
  durationMs: number;
}

// Core metrics for evaluation
export interface EvalMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

// Single run result
export interface RunResult {
  runNumber: number;
  fixtures: FixtureResult[];
  metrics: EvalMetrics;
  durationMs: number;
}

// Full evaluation result
// Note: aggregated is imported from metrics.ts to avoid circular deps
export interface EvalResult {
  runs: RunResult[];
  aggregated: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1: number;
    fixtureCount: number;
    totalExpectedBugs: number;
  };
  totalDurationMs: number;
  timestamp: string;
  model?: string;
}
