import { z } from 'zod';

/**
 * A cluster of similar findings from JSONL logs.
 * Grouped by normalized title pattern.
 */
export const FindingClusterSchema = z.object({
  /** Unique cluster identifier */
  id: z.string(),
  /** Normalized title pattern used for grouping */
  pattern: z.string(),
  /** Most common severity across findings in this cluster */
  severity: z.enum(['high', 'medium', 'low']),
  /** Skills that produced findings in this cluster */
  skills: z.array(z.string()),
  /** Number of distinct runs this pattern appeared in */
  runCount: z.number().int().positive(),
  /** Original finding titles (deduplicated) */
  titles: z.array(z.string()),
  /** Sample descriptions (max 3) */
  descriptions: z.array(z.string()).max(3),
  /** File paths where this pattern was found */
  paths: z.array(z.string()),
  /** Code examples from findings (max 5) */
  codeExamples: z.array(z.string()).max(5),
  /** Haiku classification result */
  classification: z.enum(['lint-catchable', 'semantic']),
  /** Reasoning for the classification */
  classificationReasoning: z.string(),
});
export type FindingCluster = z.infer<typeof FindingClusterSchema>;

/**
 * Unclassified cluster before Haiku pass.
 */
export type RawCluster = Omit<FindingCluster, 'classification' | 'classificationReasoning'>;

/**
 * A proposed lint rule that could catch a finding pattern.
 */
export const RuleProposalSchema = z.object({
  /** ID of the cluster this proposal addresses */
  clusterId: z.string(),
  /** Target linter */
  linter: z.string(),
  /** Type of proposal */
  type: z.enum(['enable-rule', 'custom-rule', 'no-viable-rule']),
  /** Existing rule code (e.g., "E722", "B006") */
  ruleCode: z.string().optional(),
  /** flake8 --select value */
  selectValue: z.string().optional(),
  /** Why this rule matches the pattern */
  rationale: z.string(),
  /** What might go wrong */
  uncertainties: z.array(z.string()),
  /** AST visitor code for custom rules */
  customRuleCode: z.string().optional(),
  /** Result of adversarial verification */
  adversarialVerdict: z.enum(['pass', 'fail']),
  /** Issues raised by adversarial check */
  adversarialIssues: z.array(z.string()),
});
export type RuleProposal = z.infer<typeof RuleProposalSchema>;

/**
 * A single hit from backtesting a rule against the codebase.
 */
export const BacktestHitSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  message: z.string(),
  /** Whether this hit matches an original finding location */
  isOriginalFinding: z.boolean(),
});
export type BacktestHit = z.infer<typeof BacktestHitSchema>;

/**
 * Result of backtesting a proposed rule against the codebase.
 */
export const BacktestResultSchema = z.object({
  /** ID of the cluster this result addresses */
  clusterId: z.string(),
  /** Rule code that was tested */
  ruleCode: z.string(),
  /** Target linter */
  linter: z.string(),
  /** Whether flake8 recognized the rule */
  ruleRecognized: z.boolean(),
  /** Total number of hits across the codebase */
  totalHits: z.number().int().nonnegative(),
  /** Hits matching original finding locations */
  truePositives: z.number().int().nonnegative(),
  /** Hits at new locations */
  newHits: z.number().int().nonnegative(),
  /** Sample hits (max 10) */
  sampleHits: z.array(BacktestHitSchema).max(10),
  /** Final recommendation */
  recommendation: z.enum(['adopt', 'review', 'reject']),
  /** Why this recommendation was made */
  recommendationReason: z.string(),
});
export type BacktestResult = z.infer<typeof BacktestResultSchema>;

/**
 * Full pipeline result stored to disk.
 */
export const RulesPipelineResultSchema = z.object({
  /** When the pipeline ran */
  timestamp: z.string().datetime(),
  /** Duration of the full pipeline in ms */
  durationMs: z.number().nonnegative(),
  /** All clusters found in harvest */
  clusters: z.array(FindingClusterSchema),
  /** Rule proposals from propose pass */
  proposals: z.array(RuleProposalSchema),
  /** Backtest results */
  backtests: z.array(BacktestResultSchema),
  /** Options used for this run */
  options: z.object({
    since: z.string().optional(),
  }),
});
export type RulesPipelineResult = z.infer<typeof RulesPipelineResultSchema>;

/**
 * CLI options for the generate-linters command.
 */
export interface GenerateLintersOptions {
  since?: string;
  json: boolean;
}
