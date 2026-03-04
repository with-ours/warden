import chalk from 'chalk';
import type { Reporter } from '../cli/output/reporter.js';
import { pluralize, formatDuration } from '../cli/output/index.js';
import type { FindingCluster, RuleProposal, BacktestResult, RulesPipelineResult } from './types.js';

/**
 * Render harvest results to terminal.
 */
export function renderHarvestResults(
  clusters: FindingCluster[],
  reporter: Reporter,
): void {
  const lintCatchable = clusters.filter((c) => c.classification === 'lint-catchable');
  const semantic = clusters.filter((c) => c.classification === 'semantic');

  reporter.blank();
  reporter.text(chalk.bold('HARVEST'));
  reporter.text(
    `  ${chalk.cyan(String(clusters.length))} patterns found  ` +
    chalk.green(`${lintCatchable.length} lint-catchable`) + '  ' +
    chalk.dim(`${semantic.length} semantic`),
  );
  reporter.blank();

  if (lintCatchable.length > 0) {
    reporter.text(chalk.bold('  Lint-catchable patterns:'));
    for (const cluster of lintCatchable) {
      const title = cluster.titles[0]?.slice(0, 70) ?? cluster.pattern;
      reporter.text(
        `  ${chalk.green('\u25cf')} ${title}` +
        chalk.dim(` (${cluster.runCount}x, ${cluster.severity})`),
      );
      reporter.text(chalk.dim(`    ${cluster.classificationReasoning.slice(0, 100)}`));
    }
    reporter.blank();
  }

  if (semantic.length > 0) {
    reporter.text(chalk.dim('  Semantic patterns (skipped):'));
    for (const cluster of semantic) {
      const title = cluster.titles[0]?.slice(0, 70) ?? cluster.pattern;
      reporter.text(chalk.dim(`  \u25cb ${title} (${cluster.runCount}x)`));
    }
    reporter.blank();
  }
}

/**
 * Render proposal results to terminal.
 */
export function renderProposalResults(
  proposals: RuleProposal[],
  clusters: FindingCluster[],
  reporter: Reporter,
): void {
  const passed = proposals.filter((p) => p.adversarialVerdict === 'pass' && p.type !== 'no-viable-rule');
  const failed = proposals.filter((p) => p.adversarialVerdict === 'fail');
  const noViable = proposals.filter((p) => p.type === 'no-viable-rule');

  const clusterMap = new Map(clusters.map((c) => [c.id, c]));

  reporter.blank();
  reporter.text(chalk.bold('PROPOSALS'));
  reporter.text(
    `  ${chalk.green(String(passed.length))} passed  ` +
    chalk.red(`${failed.length} failed`) + '  ' +
    chalk.dim(`${noViable.length} no-viable-rule`),
  );
  reporter.blank();

  for (const proposal of passed) {
    const cluster = clusterMap.get(proposal.clusterId);
    const title = cluster?.titles[0]?.slice(0, 50) ?? proposal.clusterId;

    reporter.text(`  ${chalk.green('\u2713')} ${chalk.bold(proposal.ruleCode ?? 'custom-rule')} \u2190 ${title}`);
    reporter.text(chalk.dim(`    ${proposal.rationale.slice(0, 100)}`));

    if (proposal.uncertainties.length > 0) {
      reporter.text(chalk.yellow(`    Uncertainties: ${proposal.uncertainties[0]?.slice(0, 80)}`));
    }
  }

  if (failed.length > 0) {
    reporter.blank();
    reporter.text(chalk.dim('  Failed adversarial check:'));
    for (const proposal of failed) {
      const cluster = clusterMap.get(proposal.clusterId);
      const title = cluster?.titles[0]?.slice(0, 50) ?? proposal.clusterId;
      reporter.text(chalk.dim(`  \u2717 ${proposal.ruleCode ?? 'unknown'} \u2190 ${title}`));
      if (proposal.adversarialIssues.length > 0) {
        reporter.text(chalk.dim(`    ${proposal.adversarialIssues[0]?.slice(0, 80)}`));
      }
    }
  }

  reporter.blank();
}

/**
 * Render backtest results to terminal.
 */
export function renderBacktestResults(
  results: BacktestResult[],
  clusters: FindingCluster[],
  reporter: Reporter,
): void {
  const adopted = results.filter((r) => r.recommendation === 'adopt');
  const review = results.filter((r) => r.recommendation === 'review');
  const rejected = results.filter((r) => r.recommendation === 'reject');

  const clusterMap = new Map(clusters.map((c) => [c.id, c]));

  reporter.blank();
  reporter.text(chalk.bold('BACKTEST'));
  reporter.text(
    `  ${chalk.green(String(adopted.length))} adopt  ` +
    chalk.yellow(`${review.length} review`) + '  ' +
    chalk.red(`${rejected.length} reject`),
  );
  reporter.blank();

  // Adopt rules
  for (const result of adopted) {
    const cluster = clusterMap.get(result.clusterId);
    const title = cluster?.titles[0]?.slice(0, 50) ?? result.clusterId;

    reporter.text(`  ${chalk.green('\u2713')} ${chalk.bold(result.ruleCode)} \u2190 ${title}`);
    reporter.text(
      chalk.dim(`    ${result.totalHits} hits (${result.truePositives} original, ${result.newHits} new)`),
    );

    // Show a few sample hits
    for (const hit of result.sampleHits.slice(0, 3)) {
      const marker = hit.isOriginalFinding ? chalk.green('\u2022') : chalk.dim('\u2022');
      reporter.text(`    ${marker} ${hit.path}:${hit.line} ${chalk.dim(hit.message.slice(0, 60))}`);
    }
  }

  // Review rules
  if (review.length > 0) {
    reporter.blank();
    reporter.text(chalk.yellow('  Needs review:'));
    for (const result of review) {
      reporter.text(`  ${chalk.yellow('?')} ${chalk.bold(result.ruleCode)} \u2014 ${result.recommendationReason.slice(0, 80)}`);
    }
  }

  // Rejected rules
  if (rejected.length > 0) {
    reporter.blank();
    reporter.text(chalk.dim('  Rejected:'));
    for (const result of rejected) {
      reporter.text(chalk.dim(`  \u2717 ${result.ruleCode} \u2014 ${result.recommendationReason.slice(0, 80)}`));
    }
  }

  reporter.blank();
}

/**
 * Render the full pipeline summary.
 */
export function renderPipelineSummary(
  result: RulesPipelineResult,
  reporter: Reporter,
): void {
  const adopted = result.backtests.filter((r) => r.recommendation === 'adopt');
  const review = result.backtests.filter((r) => r.recommendation === 'review');

  reporter.blank();
  reporter.text(chalk.bold('SUMMARY'));

  const clusterCount = result.clusters.length;
  const lintCatchable = result.clusters.filter((c) => c.classification === 'lint-catchable').length;
  const proposalsPassed = result.proposals.filter((p) => p.adversarialVerdict === 'pass' && p.type !== 'no-viable-rule').length;

  reporter.text(
    `  ${clusterCount} ${pluralize(clusterCount, 'pattern')} \u2192 ` +
    `${lintCatchable} lint-catchable \u2192 ` +
    `${proposalsPassed} proposed \u2192 ` +
    chalk.green(`${adopted.length} adopt`) +
    (review.length > 0 ? ` + ${chalk.yellow(`${review.length} review`)}` : ''),
  );

  reporter.text(chalk.dim(`  Completed in ${formatDuration(result.durationMs)}`));

  if (adopted.length > 0) {
    reporter.blank();
    reporter.text(chalk.bold('  Rules to adopt:'));
    const clusterMap = new Map(result.clusters.map((c) => [c.id, c]));

    for (const bt of adopted) {
      const cluster = clusterMap.get(bt.clusterId);
      const title = cluster?.titles[0]?.slice(0, 50) ?? bt.clusterId;
      reporter.text(`  ${chalk.green('\u2713')} flake8 --select=${bt.ruleCode}  ${chalk.dim(`(${title})`)}`);
    }
  }

  if (review.length > 0) {
    reporter.blank();
    reporter.text(chalk.bold('  Rules to review:'));
    for (const bt of review) {
      reporter.text(`  ${chalk.yellow('?')} ${bt.ruleCode}  ${chalk.dim(bt.recommendationReason.slice(0, 60))}`);
    }
  }

  reporter.blank();
}

/**
 * Render pipeline result as JSON to stdout.
 */
export function renderPipelineJson(result: RulesPipelineResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
