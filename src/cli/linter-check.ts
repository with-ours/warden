/**
 * Linter evaluation second pass.
 *
 * After findings are reported, evaluates whether each fixable finding
 * could be caught by a deterministic linter rule. Proposes config
 * changes as fixable findings that flow through the normal fix mechanism.
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, UsageStats } from '../types/index.js';
import { extractBalancedJson } from '../sdk/extract.js';
import { generateShortId } from '../sdk/extract.js';
import type { Reporter } from './output/reporter.js';
import { formatDuration, formatCost } from './output/formatters.js';

/** Detected linter config file. */
export interface LinterConfig {
  path: string;
  contents: string;
}

/** Rule proposal from the LLM. */
export interface RuleProposal {
  rule: string;
  description: string;
  findingIds: string[];
  configDiff: string;
}

/** Full result of the linter evaluation pass. */
export interface LinterCheckResult {
  findings: Finding[];
  /** Maps original finding ID -> prevention info for inline display */
  preventionMap: Map<string, PreventionInfo>;
  usage: UsageStats;
  durationMs: number;
}

/** Config filenames to search for, in priority order. */
const CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'biome.json',
  'biome.jsonc',
];

/**
 * Detect the linter config file in the repo root.
 */
export function detectLinterConfig(repoPath: string): LinterConfig | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const fullPath = join(repoPath, candidate);
    if (existsSync(fullPath)) {
      const contents = readFileSync(fullPath, 'utf-8');
      return { path: fullPath, contents };
    }
  }
  return null;
}

/**
 * Build the prompt for evaluating findings and proposing lint rules.
 */
export function buildLinterCheckPrompt(
  findings: Finding[],
  config: LinterConfig
): string {
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

  return `You are a linter rule expert. For each finding below, determine if a custom, domain-specific lint rule could deterministically catch the same class of issue via AST or pattern matching.

IMPORTANT:
- Do NOT suggest well-known generic rules (no-eval, eqeqeq, no-var, etc.). Those are table stakes and already known.
- Instead, propose custom rules that encode the specific pattern from this codebase. Describe the exact AST shape the rule would match.
- Example: "ban-exec-template-literal: Flags execSync/execFileSync/exec called with a template literal argument. AST: CallExpression where callee matches exec* and first argument is TemplateLiteral with expressions."
- The rule must be deterministic and implementable as an ESLint rule visitor, not a heuristic.

If you propose a rule, produce a unified diff against the config file that adds a comment documenting the rule and a TODO to implement it.

Config file: ${config.path}
\`\`\`
${config.contents}
\`\`\`

Findings:
${findingEntries.join('\n\n')}

Group related findings under one rule when the same pattern catches multiple issues.

Respond with JSON only. Format:
{
  "rules": [
    {
      "rule": "<descriptive-rule-name>",
      "description": "<exact AST pattern the rule matches and why it catches this class of bug>",
      "findingIds": ["<id1>", "<id2>"],
      "configDiff": "<unified diff against the config file>"
    }
  ]
}

The configDiff must be a valid unified diff with @@ line markers.
If no findings have a deterministic AST pattern, return {"rules": []}.`;
}

/** Prevention info attached to a finding for inline display. */
export interface PreventionInfo {
  rule: string;
  description: string;
}

/**
 * Build a map from original finding ID to the prevention info.
 */
export function buildPreventionMap(proposals: RuleProposal[]): Map<string, PreventionInfo> {
  const map = new Map<string, PreventionInfo>();
  for (const p of proposals) {
    if (!p.rule || p.findingIds.length === 0) continue;
    for (const id of p.findingIds) {
      map.set(id, { rule: p.rule, description: p.description });
    }
  }
  return map;
}

/**
 * Convert rule proposals into fixable Finding objects.
 */
export function proposalsToFindings(
  proposals: RuleProposal[],
  configPath: string,
  originalFindings: Finding[]
): Finding[] {
  const findingMap = new Map(originalFindings.map((f) => [f.id, f]));

  return proposals
    .filter((p) => p.configDiff && p.findingIds.length > 0)
    .map((p) => {
      const caughtTitles = p.findingIds
        .map((id) => findingMap.get(id)?.title)
        .filter(Boolean);

      const catchesLabel =
        caughtTitles.length > 0
          ? `\n\nWould have caught: ${caughtTitles.join(', ')}`
          : '';

      return {
        id: generateShortId(),
        severity: 'info' as const,
        title: `Prevention: enable ${p.rule}`,
        description: `${p.description}${catchesLabel}`,
        location: { path: configPath, startLine: 1 },
        suggestedFix: {
          description: `Add ${p.rule} rule to linter config`,
          diff: p.configDiff,
        },
      };
    });
}

/**
 * Evaluate findings against linter rules using a single Haiku call.
 * Returns fixable Finding objects targeting the linter config.
 */
export async function evaluateLinterRules(
  findings: Finding[],
  config: LinterConfig,
  apiKey: string
): Promise<LinterCheckResult> {
  const startTime = Date.now();
  const prompt = buildLinterCheckPrompt(findings, config);

  const client = new Anthropic({ apiKey, timeout: 30_000 });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '{' },
    ],
  });

  const durationMs = Date.now() - startTime;

  const usage: UsageStats = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    costUSD: estimateHaikuCost(response.usage),
  };

  const empty: LinterCheckResult = { findings: [], preventionMap: new Map(), usage, durationMs };

  // Extract JSON from response (prefill means we prepend the '{')
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    return empty;
  }

  const rawJson = '{' + content.text;
  const jsonStr = extractBalancedJson(rawJson, 0);
  if (!jsonStr) {
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return empty;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('rules' in parsed) ||
    !Array.isArray((parsed as { rules: unknown }).rules)
  ) {
    return empty;
  }

  const proposals = (parsed as { rules: RuleProposal[] }).rules;
  const preventionFindings = proposalsToFindings(
    proposals,
    config.path,
    findings
  );
  const preventionMap = buildPreventionMap(proposals);

  return { findings: preventionFindings, preventionMap, usage, durationMs };
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

/** Output from the linter check pass. */
export interface LinterCheckOutput {
  /** Prevention findings (config diffs) for the fix flow */
  fixes: Finding[];
  /** Maps original finding ID -> prevention info for inline display */
  preventionMap: Map<string, PreventionInfo>;
}

/**
 * Top-level orchestrator. Returns prevention findings and a map for inline display.
 * Never throws: errors are logged as warnings.
 */
export async function runLinterCheck(
  findings: Finding[],
  repoPath: string,
  apiKey: string,
  reporter: Reporter
): Promise<LinterCheckOutput> {
  const empty: LinterCheckOutput = { fixes: [], preventionMap: new Map() };

  if (findings.length === 0) {
    return empty;
  }

  const config = detectLinterConfig(repoPath);
  if (!config) {
    reporter.debug('No linter config found, skipping linter evaluation');
    return empty;
  }

  try {
    reporter.debug('Evaluating findings for linter rule coverage...');
    const result = await evaluateLinterRules(findings, config, apiKey);

    if (result.findings.length > 0) {
      reporter.text(
        `  ${result.findings.length} prevention ${result.findings.length === 1 ? 'fix' : 'fixes'} proposed · ${formatDuration(result.durationMs)} · ${formatCost(result.usage.costUSD)}`
      );
    }

    return { fixes: result.findings, preventionMap: result.preventionMap };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.warning(`Linter evaluation failed: ${message}`);
    return empty;
  }
}
