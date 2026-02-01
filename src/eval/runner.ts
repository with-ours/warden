import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSkillAsync } from '../skills/loader.js';
import { runSkill } from '../sdk/runner.js';
import { buildFileEventContext } from '../cli/context.js';
import type { SkillReport, Finding } from '../types/index.js';
import { discoverAndLoadFixtures, getEvalSkillsDir } from './loader.js';
import { judgeFinding, findCandidateFinding, createFindingTracker } from './judge.js';
import { aggregateFixtureMetrics, aggregateRunMetrics } from './metrics.js';
import type {
  LoadedFixture,
  FixtureResult,
  MatchOutcome,
  SpuriousFinding,
  RunResult,
  EvalResult,
} from './types.js';

/**
 * Options for running an evaluation.
 */
export interface RunEvalOptions {
  /** Filter to fixtures for this skill */
  skill?: string;
  /** Filter to fixtures with this tag */
  tag?: string;
  /** Run a specific fixture by path */
  fixturePath?: string;
  /** Number of runs per fixture (default: 1) */
  runs?: number;
}

/**
 * Summary of a finding for match outcomes and spurious findings.
 * Extracts only the fields needed for eval reporting.
 */
type FindingSummary = MatchOutcome['finding'] & object;

/**
 * Extract a summary of a finding for eval reporting.
 */
function summarizeFinding(finding: Finding): NonNullable<FindingSummary> {
  return {
    id: finding.id,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    file: finding.location?.path,
    line: finding.location?.startLine,
  };
}

/**
 * Callbacks for eval progress reporting.
 */
export interface EvalRunnerCallbacks {
  onRunStart?: (runNumber: number, totalRuns: number) => void;
  onRunComplete?: (runNumber: number, totalRuns: number) => void;
  onFixtureStart?: (fixture: LoadedFixture, index: number, total: number) => void;
  onFixtureComplete?: (fixture: LoadedFixture, result: FixtureResult) => void;
  onSkillRunStart?: (fixture: LoadedFixture) => void;
  onSkillRunComplete?: (fixture: LoadedFixture, report: SkillReport) => void;
  onJudgeStart?: (fixture: LoadedFixture, bugId: string) => void;
  onJudgeComplete?: (fixture: LoadedFixture, bugId: string, matches: boolean) => void;
}

export interface EvalRunnerOptions {
  apiKey?: string;
  model?: string;
  callbacks?: EvalRunnerCallbacks;
  abortController?: AbortController;
  /** Repo root for skill resolution (defaults to cwd) */
  repoRoot?: string;
}

/**
 * Get code context around a specific line for the judge.
 */
function getCodeContext(filePath: string, line?: number, contextLines = 5): string | undefined {
  if (!line) return undefined;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);

    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a single fixture.
 */
export async function evaluateFixture(
  fixture: LoadedFixture,
  options: EvalRunnerOptions
): Promise<FixtureResult> {
  const { apiKey, model, callbacks, abortController, repoRoot } = options;
  const startTime = Date.now();

  // Build context from fixture files
  const fixtureDir = fixture.path;

  callbacks?.onSkillRunStart?.(fixture);

  // Build event context from fixture files
  const context = await buildFileEventContext({
    patterns: fixture.files,
    cwd: fixtureDir,
  });

  // Resolve skill: first check evals/skills/, then fall back to standard resolution
  const skillName = fixture.fixture.skill;
  const evalSkillPath = join(getEvalSkillsDir(), skillName);
  const skillPath = existsSync(evalSkillPath) ? evalSkillPath : skillName;
  const skillRepoRoot = repoRoot ?? process.cwd();
  const skill = await resolveSkillAsync(skillPath, skillRepoRoot);

  const report = await runSkill(skill, context, {
    apiKey,
    model,
    abortController,
  });

  callbacks?.onSkillRunComplete?.(fixture, report);

  // Match findings to expected bugs
  const findings = report.findings;
  const expectedBugs = fixture.fixture.expectedBugs;
  const matchOutcomes: MatchOutcome[] = [];
  const findingTracker = createFindingTracker();

  let found = 0;
  let missed = 0;

  for (const expectedBug of expectedBugs) {
    if (abortController?.signal.aborted) break;

    callbacks?.onJudgeStart?.(fixture, expectedBug.id);

    // Find candidate finding for this expected bug
    const candidate = findCandidateFinding(findings, expectedBug);

    if (!candidate) {
      // No finding for this file = false negative
      matchOutcomes.push({
        expectedBug,
        finding: null,
        judgeResult: null,
        outcome: 'false_negative',
      });
      missed++;
      callbacks?.onJudgeComplete?.(fixture, expectedBug.id, false);
      continue;
    }

    // Skip if this finding was already matched to another expected bug
    if (findingTracker.isUsed(candidate.id)) {
      matchOutcomes.push({
        expectedBug,
        finding: summarizeFinding(candidate),
        judgeResult: null,
        outcome: 'false_negative',
      });
      missed++;
      callbacks?.onJudgeComplete?.(fixture, expectedBug.id, false);
      continue;
    }

    // Get code context for the judge
    const bugFilePath = fixture.files.find((f) => f.endsWith(expectedBug.file));
    const codeContext = bugFilePath
      ? getCodeContext(bugFilePath, expectedBug.line)
      : undefined;

    // Judge the finding
    const judgeResult = await judgeFinding(candidate, expectedBug, {
      apiKey,
      codeContext,
    });

    const matches = judgeResult.matches;

    matchOutcomes.push({
      expectedBug,
      finding: summarizeFinding(candidate),
      judgeResult,
      outcome: matches ? 'true_positive' : 'false_negative',
    });

    if (matches) {
      found++;
      findingTracker.markUsed(candidate.id);
    } else {
      missed++;
    }

    callbacks?.onJudgeComplete?.(fixture, expectedBug.id, matches);
  }

  // Find spurious findings (false positives)
  // These are findings for files that have no expected bugs
  const filesWithExpectedBugs = new Set(expectedBugs.map((b) => b.file));
  const spuriousFindings: SpuriousFinding[] = [];

  for (const finding of findings) {
    const findingFile = finding.location?.path;
    if (!findingFile) continue;

    // Check if this file has any expected bugs
    if (!filesWithExpectedBugs.has(findingFile)) {
      spuriousFindings.push({ finding: summarizeFinding(finding) });
    }
  }

  return {
    fixture: fixture.name,
    skill: fixture.fixture.skill,
    description: fixture.fixture.description,
    expectedBugs: expectedBugs.length,
    found,
    missed,
    spurious: spuriousFindings.length,
    matchOutcomes,
    spuriousFindings,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run a single evaluation pass over all fixtures.
 */
async function runSingleEval(
  fixtures: LoadedFixture[],
  runNumber: number,
  options: EvalRunnerOptions
): Promise<RunResult> {
  const { callbacks, abortController } = options;
  const startTime = Date.now();
  const fixtureResults: FixtureResult[] = [];

  for (let i = 0; i < fixtures.length; i++) {
    if (abortController?.signal.aborted) break;

    const fixture = fixtures[i];
    if (!fixture) continue;
    callbacks?.onFixtureStart?.(fixture, i, fixtures.length);

    const result = await evaluateFixture(fixture, options);
    fixtureResults.push(result);

    callbacks?.onFixtureComplete?.(fixture, result);
  }

  const metrics = aggregateFixtureMetrics(fixtureResults);

  return {
    runNumber,
    fixtures: fixtureResults,
    metrics,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run the full evaluation.
 */
export async function runEval(
  options: RunEvalOptions,
  runnerOptions: EvalRunnerOptions
): Promise<EvalResult> {
  const { callbacks, abortController } = runnerOptions;
  const startTime = Date.now();

  // Discover and load fixtures
  const fixtures = discoverAndLoadFixtures({
    skill: options.skill,
    tag: options.tag,
    fixturePath: options.fixturePath,
  });

  if (fixtures.length === 0) {
    return {
      runs: [],
      aggregated: {
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1: 0,
        fixtureCount: 0,
        totalExpectedBugs: 0,
      },
      totalDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      model: runnerOptions.model,
    };
  }

  // Determine number of runs
  const numRuns = options.runs ?? 1;
  const runs: RunResult[] = [];

  for (let run = 1; run <= numRuns; run++) {
    if (abortController?.signal.aborted) break;

    callbacks?.onRunStart?.(run, numRuns);

    const result = await runSingleEval(fixtures, run, runnerOptions);
    runs.push(result);

    callbacks?.onRunComplete?.(run, numRuns);
  }

  // Aggregate metrics across all runs
  const aggregated = aggregateRunMetrics(runs);

  return {
    runs,
    aggregated,
    totalDurationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    model: runnerOptions.model,
  };
}
