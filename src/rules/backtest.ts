import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { UsageStats } from '../types/index.js';
import { emptyUsage } from '../sdk/usage.js';
import type { FindingCluster, RuleProposal, BacktestResult, BacktestHit } from './types.js';

/**
 * Detect flake8 in the target repo.
 * Checks venv, then PATH.
 */
function findFlake8(repoPath: string): string | undefined {
  // Check common venv locations
  const venvPaths = [
    join(repoPath, '.venv', 'bin', 'flake8'),
    join(repoPath, 'venv', 'bin', 'flake8'),
    join(repoPath, '.tox', 'lint', 'bin', 'flake8'),
  ];

  for (const venvPath of venvPaths) {
    if (existsSync(venvPath)) return venvPath;
  }

  // Check PATH
  try {
    const which = execSync('which flake8', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (which) return which;
  } catch {
    // Not in PATH
  }

  return undefined;
}

/**
 * Parse flake8 output line: path:line:col: CODE message
 */
function parseFlake8Line(line: string): { path: string; line: number; col: number; code: string; message: string } | undefined {
  const match = line.match(/^(.+?):(\d+):(\d+): (\w+) (.+)$/);
  if (!match) return undefined;
  return {
    path: match[1] ?? '',
    line: parseInt(match[2] ?? '0', 10),
    col: parseInt(match[3] ?? '0', 10),
    code: match[4] ?? '',
    message: match[5] ?? '',
  };
}

/**
 * Check if a flake8 hit matches an original finding location (within a 5-line window).
 */
function isOriginalFinding(
  hitPath: string,
  hitLine: number,
  originalPaths: string[],
  originalFindings: { path?: string; startLine?: number }[],
): boolean {
  for (const finding of originalFindings) {
    if (!finding.path || !finding.startLine) continue;

    // Normalize paths for comparison (strip leading ./ or repo prefix)
    const normHit = hitPath.replace(/^\.\//, '');
    const normFinding = finding.path.replace(/^\.\//, '');

    if (!normHit.endsWith(normFinding) && !normFinding.endsWith(normHit) && normHit !== normFinding) {
      continue;
    }

    // 5-line fuzzy window
    if (Math.abs(hitLine - finding.startLine) <= 5) {
      return true;
    }
  }
  return false;
}

interface BacktestOptions {
  repoPath: string;
  flake8Path?: string;
}

/**
 * Run backtest for a single enable-rule proposal.
 */
function backtestEnableRule(
  proposal: RuleProposal,
  cluster: FindingCluster,
  options: BacktestOptions,
): BacktestResult {
  const { repoPath } = options;
  const flake8 = options.flake8Path ?? findFlake8(repoPath);

  if (!flake8) {
    return {
      clusterId: proposal.clusterId,
      ruleCode: proposal.ruleCode ?? 'unknown',
      linter: proposal.linter,
      ruleRecognized: false,
      totalHits: 0,
      truePositives: 0,
      newHits: 0,
      sampleHits: [],
      recommendation: 'reject',
      recommendationReason: 'flake8 not found in repo or PATH',
    };
  }

  const selectValue = proposal.selectValue ?? proposal.ruleCode ?? '';

  let stdout = '';
  let exitCode = 0;

  try {
    stdout = execSync(
      `${flake8} --select=${selectValue} --format='%(path)s:%(row)d:%(col)d: %(code)s %(text)s' .`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    exitCode = 0;
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string };
    exitCode = execErr.status ?? 1;
    stdout = execErr.stdout ?? '';

    // flake8 exits 1 when it finds violations (expected)
    if (exitCode !== 1) {
      return {
        clusterId: proposal.clusterId,
        ruleCode: proposal.ruleCode ?? 'unknown',
        linter: proposal.linter,
        ruleRecognized: false,
        totalHits: 0,
        truePositives: 0,
        newHits: 0,
        sampleHits: [],
        recommendation: 'reject',
        recommendationReason: `flake8 exited with code ${exitCode}: ${(execErr.stderr ?? '').slice(0, 200)}`,
      };
    }
  }

  const lines = stdout.trim().split('\n').filter(Boolean);
  const hits = lines.map(parseFlake8Line).filter((h): h is NonNullable<typeof h> => h !== undefined);

  // Zero hits on a nonempty codebase = suspicious
  if (hits.length === 0) {
    return {
      clusterId: proposal.clusterId,
      ruleCode: proposal.ruleCode ?? 'unknown',
      linter: proposal.linter,
      ruleRecognized: false,
      totalHits: 0,
      truePositives: 0,
      newHits: 0,
      sampleHits: [],
      recommendation: 'reject',
      recommendationReason: 'Rule produced zero hits. Likely not recognized or not applicable to this codebase.',
    };
  }

  // Cross-reference hits against original findings
  const originalFindings = cluster.paths.map((p) => {
    // Try to extract line from descriptions or just use path
    return { path: p, startLine: undefined as number | undefined };
  });

  // Also pull location data from finding descriptions if we have any
  // In practice, the cluster paths are the best we have
  const sampleHits: BacktestHit[] = [];
  let truePositives = 0;
  let newHits = 0;

  for (const hit of hits) {
    const isOriginal = isOriginalFinding(hit.path, hit.line, cluster.paths, originalFindings);
    if (isOriginal) {
      truePositives++;
    } else {
      newHits++;
    }

    if (sampleHits.length < 10) {
      sampleHits.push({
        path: hit.path,
        line: hit.line,
        message: hit.message,
        isOriginalFinding: isOriginal,
      });
    }
  }

  // Determine recommendation
  let recommendation: BacktestResult['recommendation'];
  let recommendationReason: string;

  if (truePositives === 0 && cluster.paths.length > 0) {
    recommendation = 'reject';
    recommendationReason = `Rule fires ${hits.length} times but none match original finding locations. Likely a different pattern.`;
  } else if (hits.length > 200) {
    recommendation = 'review';
    recommendationReason = `Rule fires ${hits.length} times. Too broad for automatic adoption. Review needed.`;
  } else if (proposal.type === 'custom-rule') {
    recommendation = 'review';
    recommendationReason = `Custom AST rule fires ${hits.length} times (${truePositives} on originals). Needs human review before adoption.`;
  } else {
    recommendation = 'adopt';
    recommendationReason = `Rule fires ${hits.length} times (${truePositives} on original locations, ${newHits} new). Manageable hit count.`;
  }

  return {
    clusterId: proposal.clusterId,
    ruleCode: proposal.ruleCode ?? 'unknown',
    linter: proposal.linter,
    ruleRecognized: true,
    totalHits: hits.length,
    truePositives,
    newHits,
    sampleHits,
    recommendation,
    recommendationReason,
  };
}

/**
 * Run backtest for a custom-rule proposal.
 * Writes AST visitor to temp dir, registers as local plugin, runs flake8.
 */
function backtestCustomRule(
  proposal: RuleProposal,
  cluster: FindingCluster,
  options: BacktestOptions,
): BacktestResult {
  const { repoPath } = options;
  const flake8 = options.flake8Path ?? findFlake8(repoPath);

  if (!flake8) {
    return {
      clusterId: proposal.clusterId,
      ruleCode: 'custom',
      linter: proposal.linter,
      ruleRecognized: false,
      totalHits: 0,
      truePositives: 0,
      newHits: 0,
      sampleHits: [],
      recommendation: 'reject',
      recommendationReason: 'flake8 not found in repo or PATH',
    };
  }

  if (!proposal.customRuleCode) {
    return {
      clusterId: proposal.clusterId,
      ruleCode: 'custom',
      linter: proposal.linter,
      ruleRecognized: false,
      totalHits: 0,
      truePositives: 0,
      newHits: 0,
      sampleHits: [],
      recommendation: 'reject',
      recommendationReason: 'No custom rule code provided',
    };
  }

  // Write custom checker to temp directory
  const tmpDir = join(tmpdir(), `warden-custom-rule-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    writeFileSync(join(tmpDir, 'checker.py'), proposal.customRuleCode);

    // Create setup.cfg that registers the local plugin
    const setupCfg = `[flake8:local-plugins]
paths = ${tmpDir}
extension =
  X0 = checker:CustomChecker
`;
    writeFileSync(join(tmpDir, 'setup.cfg'), setupCfg);

    let stdout = '';
    try {
      stdout = execSync(
        `${flake8} --select=X0 --format='%(path)s:%(row)d:%(col)d: %(code)s %(text)s' .`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            FLAKE8_CONFIG: join(tmpDir, 'setup.cfg'),
          },
        },
      );
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string };
      if (execErr.status !== 1) {
        return {
          clusterId: proposal.clusterId,
          ruleCode: 'custom',
          linter: proposal.linter,
          ruleRecognized: false,
          totalHits: 0,
          truePositives: 0,
          newHits: 0,
          sampleHits: [],
          recommendation: 'reject',
          recommendationReason: `Custom rule failed: ${(execErr.stderr ?? '').slice(0, 200)}`,
        };
      }
      stdout = execErr.stdout ?? '';
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    const hits = lines.map(parseFlake8Line).filter((h): h is NonNullable<typeof h> => h !== undefined);

    const sampleHits: BacktestHit[] = hits.slice(0, 10).map((h) => ({
      path: h.path,
      line: h.line,
      message: h.message,
      isOriginalFinding: false,
    }));

    // Custom rules always go to review
    return {
      clusterId: proposal.clusterId,
      ruleCode: 'custom',
      linter: proposal.linter,
      ruleRecognized: hits.length > 0,
      totalHits: hits.length,
      truePositives: 0,
      newHits: hits.length,
      sampleHits,
      recommendation: 'review',
      recommendationReason: `Custom AST rule fires ${hits.length} times. Always flagged for human review.`,
    };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Pass 3: Backtest proposed rules against the target codebase.
 *
 * Runs flake8 with each proposed rule and checks whether it fires
 * on original finding locations.
 */
export function backtest(
  proposals: RuleProposal[],
  clusters: FindingCluster[],
  repoPath: string,
  onProgress?: (message: string) => void,
): { results: BacktestResult[]; usage: UsageStats } {
  // Only backtest proposals that passed adversarial check and have a rule
  const viable = proposals.filter(
    (p) => p.adversarialVerdict === 'pass' && p.type !== 'no-viable-rule',
  );

  if (viable.length === 0) {
    onProgress?.('No viable proposals to backtest');
    return { results: [], usage: emptyUsage() };
  }

  // Detect flake8 once
  const flake8Path = findFlake8(repoPath);
  if (!flake8Path) {
    onProgress?.('flake8 not found. Install flake8 in the target repo to enable backtesting.');
    return {
      results: viable.map((p) => ({
        clusterId: p.clusterId,
        ruleCode: p.ruleCode ?? 'unknown',
        linter: p.linter,
        ruleRecognized: false,
        totalHits: 0,
        truePositives: 0,
        newHits: 0,
        sampleHits: [],
        recommendation: 'reject' as const,
        recommendationReason: 'flake8 not found',
      })),
      usage: emptyUsage(),
    };
  }

  onProgress?.(`Backtesting ${viable.length} rules against ${repoPath}`);

  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const results: BacktestResult[] = [];

  for (const proposal of viable) {
    const cluster = clusterMap.get(proposal.clusterId);
    if (!cluster) continue;

    onProgress?.(`  Testing ${proposal.ruleCode ?? 'custom-rule'}...`);

    const result = proposal.type === 'custom-rule'
      ? backtestCustomRule(proposal, cluster, { repoPath, flake8Path })
      : backtestEnableRule(proposal, cluster, { repoPath, flake8Path });

    results.push(result);

    onProgress?.(`  ${result.recommendation}: ${result.totalHits} hits (${result.recommendationReason.slice(0, 80)})`);
  }

  const adopted = results.filter((r) => r.recommendation === 'adopt');
  const review = results.filter((r) => r.recommendation === 'review');
  const rejected = results.filter((r) => r.recommendation === 'reject');
  onProgress?.(`Backtest complete: ${adopted.length} adopt, ${review.length} review, ${rejected.length} reject`);

  // No LLM usage in backtest pass
  return { results, usage: emptyUsage() };
}
