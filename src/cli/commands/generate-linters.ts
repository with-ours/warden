import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRepoRoot } from '../git.js';
import { getAnthropicApiKey } from '../../utils/index.js';
import { verifyAuth, type WardenAuthenticationError } from '../../sdk/runner.js';
import { harvest } from '../../rules/harvest.js';
import { propose } from '../../rules/propose.js';
import { backtest } from '../../rules/backtest.js';
import {
  renderHarvestResults,
  renderProposalResults,
  renderBacktestResults,
  renderPipelineSummary,
  renderPipelineJson,
} from '../../rules/output.js';
import type { Reporter } from '../output/reporter.js';
import type { GenerateLintersOptions, RulesPipelineResult } from '../../rules/types.js';

function saveResult(repoPath: string, result: RulesPipelineResult): string {
  const dir = join(repoPath, '.warden', 'rules');
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${ts}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

/**
 * Run the generate-linters pipeline.
 *
 * Reads historical JSONL logs, clusters recurring findings,
 * classifies which ones a linter could catch, proposes flake8 rules,
 * challenges each proposal, then backtests survivors against the repo.
 */
export async function runGenerateLinters(
  options: GenerateLintersOptions,
  reporter: Reporter,
): Promise<number> {
  const cwd = process.cwd();
  let repoPath: string;
  try {
    repoPath = getRepoRoot(cwd);
  } catch {
    reporter.error('Not a git repository');
    return 1;
  }

  const startTime = Date.now();

  // Auth
  const apiKey = getAnthropicApiKey() ?? '';
  if (!apiKey) {
    reporter.error('API key required. Set ANTHROPIC_API_KEY or WARDEN_ANTHROPIC_API_KEY.');
    return 1;
  }
  try {
    verifyAuth({ apiKey });
  } catch (error: unknown) {
    reporter.error((error as WardenAuthenticationError).message);
    return 1;
  }

  // Pass 1: Harvest
  const logDir = join(repoPath, '.warden', 'logs');
  if (!existsSync(logDir)) {
    reporter.warning('No log directory found. Run warden first to generate logs.');
    return 0;
  }

  reporter.step('Harvesting findings from logs...');
  const { clusters } = await harvest(logDir, { since: options.since }, apiKey, (msg) => reporter.step(msg));

  if (!options.json) {
    renderHarvestResults(clusters, reporter);
  }

  const lintCatchable = clusters.filter((c) => c.classification === 'lint-catchable');
  if (lintCatchable.length === 0) {
    reporter.warning('No lint-catchable patterns found.');
    return 0;
  }

  // Pass 2: Propose
  reporter.step('Proposing lint rules...');
  const { proposals } = await propose(clusters, 'flake8', apiKey, (msg) => reporter.step(msg));

  if (!options.json) {
    renderProposalResults(proposals, clusters, reporter);
  }

  const viable = proposals.filter((p) => p.adversarialVerdict === 'pass' && p.type !== 'no-viable-rule');

  // Pass 3: Backtest
  let backtests: RulesPipelineResult['backtests'] = [];

  if (viable.length > 0) {
    reporter.step('Backtesting rules against codebase...');
    const backtestResult = backtest(proposals, clusters, repoPath, (msg) => reporter.step(msg));
    backtests = backtestResult.results;

    if (!options.json) {
      renderBacktestResults(backtests, clusters, reporter);
    }
  }

  // Save + output
  const result: RulesPipelineResult = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    clusters,
    proposals,
    backtests,
    options: { since: options.since },
  };

  if (options.json) {
    renderPipelineJson(result);
  } else {
    renderPipelineSummary(result, reporter);
    const path = saveResult(repoPath, result);
    reporter.dim(`Saved to ${path}`);
  }

  return 0;
}
