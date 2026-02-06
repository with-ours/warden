/**
 * Linter evaluation second pass.
 *
 * After findings are reported, evaluates whether each fixable finding
 * could be caught by a deterministic linter rule. Groups results by
 * linter::rule and renders a PREVENTION section.
 */

import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import type { Finding, UsageStats } from '../types/index.js';
import { extractBalancedJson } from '../sdk/extract.js';
import type { Reporter } from './output/reporter.js';
import { formatDuration, formatCost, pluralize } from './output/formatters.js';

/** Verdict for a single finding's lintability. */
export interface LinterVerdict {
  findingId: string;
  detectable: boolean;
  linter: string | null;
  rule: string | null;
  reasoning: string;
}

/** Findings grouped by a specific linter rule. */
export interface GroupedRule {
  linter: string;
  rule: string;
  findings: Finding[];
}

/** Full result of the linter evaluation pass. */
export interface LinterCheckResult {
  verdicts: LinterVerdict[];
  grouped: GroupedRule[];
  usage: UsageStats;
  durationMs: number;
}

/**
 * Build the prompt for evaluating whether findings are linter-detectable.
 */
export function buildLinterCheckPrompt(findings: Finding[]): string {
  const findingEntries = findings.map((f) => {
    const loc = f.location
      ? `  file: ${f.location.path}:${f.location.startLine}`
      : '';
    const diff = f.suggestedFix?.diff
      ? `  diff: |\n${f.suggestedFix.diff.split('\n').map((l) => `    ${l}`).join('\n')}`
      : '';

    return [
      `- id: "${f.id}"`,
      `  title: "${f.title}"`,
      `  description: "${f.description}"`,
      loc,
      diff,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `You are a linter rule expert. For each finding below, determine if a specific, existing, deterministic linter rule could reliably catch the same class of issue.

Requirements:
- Only flag findings where a real, published linter rule exists
- The rule must be deterministic (not heuristic, not AI-based)
- Include the exact linter name and rule identifier
- The fix diff is the strongest signal: look at what changed

Findings:
${findingEntries.join('\n\n')}

Respond with JSON only. Format:
{
  "verdicts": [
    {
      "findingId": "<id>",
      "detectable": true/false,
      "linter": "<linter name or null>",
      "rule": "<rule id or null>",
      "reasoning": "<brief explanation>"
    }
  ]
}`;
}

/**
 * Group verdicts by linter::rule and attach the original findings.
 * Sorted by finding count descending.
 */
export function groupByRule(
  verdicts: LinterVerdict[],
  findings: Finding[]
): GroupedRule[] {
  const findingMap = new Map(findings.map((f) => [f.id, f]));
  const groups = new Map<string, GroupedRule>();

  for (const v of verdicts) {
    if (!v.detectable || !v.linter || !v.rule) continue;

    const key = `${v.linter}::${v.rule}`;
    let group = groups.get(key);
    if (!group) {
      group = { linter: v.linter, rule: v.rule, findings: [] };
      groups.set(key, group);
    }

    const finding = findingMap.get(v.findingId);
    if (finding) {
      group.findings.push(finding);
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.findings.length - a.findings.length
  );
}

/**
 * Evaluate findings against known linter rules using a single Haiku call.
 */
export async function evaluateLinterRules(
  findings: Finding[],
  apiKey: string
): Promise<LinterCheckResult> {
  const startTime = Date.now();
  const prompt = buildLinterCheckPrompt(findings);

  const client = new Anthropic({ apiKey, timeout: 30_000 });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '{' },
    ],
  });

  const durationMs = Date.now() - startTime;

  // Build usage stats
  const usage: UsageStats = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    costUSD: estimateHaikuCost(response.usage),
  };

  // Extract JSON from response (prefill means we need to prepend the '{')
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    return { verdicts: [], grouped: [], usage, durationMs };
  }

  const rawJson = '{' + content.text;
  const jsonStr = extractBalancedJson(rawJson, 0);
  if (!jsonStr) {
    return { verdicts: [], grouped: [], usage, durationMs };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { verdicts: [], grouped: [], usage, durationMs };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('verdicts' in parsed) ||
    !Array.isArray((parsed as { verdicts: unknown }).verdicts)
  ) {
    return { verdicts: [], grouped: [], usage, durationMs };
  }

  const verdicts = (parsed as { verdicts: LinterVerdict[] }).verdicts;
  const grouped = groupByRule(verdicts, findings);

  return { verdicts, grouped, usage, durationMs };
}

/**
 * Estimate cost for Haiku 4.5 based on token usage.
 * Pricing: $0.80/M input, $4/M output (as of 2025).
 */
function estimateHaikuCost(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  const inputCost = (usage.input_tokens / 1_000_000) * 0.8;
  const outputCost = (usage.output_tokens / 1_000_000) * 4.0;
  const cacheReadCost =
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * 0.08;
  const cacheCreateCost =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * 1.0;
  return inputCost + outputCost + cacheReadCost + cacheCreateCost;
}

/**
 * Render the PREVENTION section to stderr.
 */
export function renderLinterCheck(
  result: LinterCheckResult,
  reporter: Reporter
): void {
  const detectableCount = result.verdicts.filter((v) => v.detectable).length;
  const totalCount = result.verdicts.length;

  if (detectableCount === 0) {
    return;
  }

  reporter.blank();

  if (reporter.mode.isTTY) {
    console.error(
      chalk.bold('PREVENTION')
    );
    console.error(
      `  ${detectableCount} of ${totalCount} ${pluralize(totalCount, 'finding')} could be caught by linter rules:`
    );
    console.error('');

    for (const group of result.grouped) {
      const ruleLabel = chalk.cyan(`${group.linter}/${group.rule}`);
      const countLabel = `${group.findings.length} ${pluralize(group.findings.length, 'finding')}`;
      console.error(`  ${ruleLabel}  ${countLabel}`);

      for (const f of group.findings) {
        const id = chalk.dim(f.id);
        const loc = f.location
          ? chalk.dim(`  ${f.location.path}:${f.location.startLine}`)
          : '';
        console.error(`    ${id} ${f.title}${loc}`);
      }
      console.error('');
    }

    console.error(
      chalk.dim(
        `  Evaluated in ${formatDuration(result.durationMs)} · ${formatCost(result.usage.costUSD)}`
      )
    );
  } else {
    console.error(
      `PREVENTION: ${detectableCount} of ${totalCount} ${pluralize(totalCount, 'finding')} could be caught by linter rules:`
    );

    for (const group of result.grouped) {
      console.error(
        `  ${group.linter}/${group.rule}  ${group.findings.length} ${pluralize(group.findings.length, 'finding')}`
      );
      for (const f of group.findings) {
        const loc = f.location
          ? `  ${f.location.path}:${f.location.startLine}`
          : '';
        console.error(`    ${f.id} ${f.title}${loc}`);
      }
    }

    console.error(
      `  Evaluated in ${formatDuration(result.durationMs)} · ${formatCost(result.usage.costUSD)}`
    );
  }
}

/**
 * Top-level orchestrator. Runs the linter evaluation pass and renders output.
 * Never throws: errors are logged as warnings.
 */
export async function runLinterCheck(
  findings: Finding[],
  apiKey: string,
  reporter: Reporter
): Promise<void> {
  if (findings.length === 0) {
    return;
  }

  try {
    const result = await evaluateLinterRules(findings, apiKey);
    renderLinterCheck(result, reporter);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    reporter.warning(`Linter evaluation failed: ${message}`);
  }
}
