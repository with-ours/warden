import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Finding, UsageStats } from '../types/index.js';
import { callHaiku } from '../sdk/haiku.js';
import { aggregateUsage, emptyUsage } from '../sdk/usage.js';
import { parseJsonlReports } from '../cli/output/jsonl.js';
import { clusterFindings } from './cluster.js';
import type { FindingCluster, RawCluster } from './types.js';

/**
 * Parse a --since value into a Date.
 * Supports ISO dates ("2026-01-01") and relative durations ("30d", "7d", "2w").
 */
export function parseSince(since: string): Date {
  // Try ISO date first
  const isoDate = new Date(since);
  if (!isNaN(isoDate.getTime()) && since.includes('-')) {
    return isoDate;
  }

  // Parse relative duration
  const match = since.match(/^(\d+)([dwm])$/);
  if (!match) {
    throw new Error(`Invalid --since value: "${since}". Use ISO date (2026-01-01) or duration (30d, 2w).`);
  }

  const amount = parseInt(match[1] ?? '0', 10);
  const unit = match[2] ?? 'd';
  const now = new Date();

  switch (unit) {
    case 'd':
      now.setDate(now.getDate() - amount);
      break;
    case 'w':
      now.setDate(now.getDate() - amount * 7);
      break;
    case 'm':
      now.setMonth(now.getMonth() - amount);
      break;
  }

  return now;
}

interface LogEntry {
  finding: Finding;
  skill: string;
  runId: string;
  timestamp: string;
}

/**
 * Read all JSONL logs from the .warden/logs directory.
 * Optionally filtered by --since and --skill.
 */
export function readLogEntries(logDir: string, options: { since?: string }): LogEntry[] {
  let entries: string[];
  try {
    entries = readdirSync(logDir).filter((e) => e.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }

  const sinceDate = options.since ? parseSince(options.since) : undefined;
  const results: LogEntry[] = [];

  for (const entry of entries) {
    const filePath = join(logDir, entry);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const parsed = parseJsonlReports(content);

    // Filter by timestamp
    if (sinceDate && parsed.runMetadata) {
      const runDate = new Date(parsed.runMetadata.timestamp);
      if (runDate < sinceDate) continue;
    }

    const runId = parsed.runMetadata?.runId ?? entry;

    for (const report of parsed.reports) {
      for (const finding of report.findings) {
        results.push({
          finding,
          skill: report.skill,
          runId,
          timestamp: parsed.runMetadata?.timestamp ?? '',
        });
      }
    }
  }

  return results;
}

/**
 * Haiku classification response schema.
 */
const ClassificationSchema = z.object({
  classification: z.enum(['lint-catchable', 'semantic']),
  reasoning: z.string(),
});

/**
 * Classify a cluster using Haiku.
 * Asks: "Could a static analysis tool catch this pattern without understanding semantic intent?"
 */
async function classifyCluster(
  cluster: RawCluster,
  apiKey: string,
): Promise<{ classification: FindingCluster['classification']; reasoning: string; usage: UsageStats }> {
  const examples = cluster.codeExamples.length > 0
    ? `\n\nCode examples:\n${cluster.codeExamples.map((e) => '```\n' + e + '\n```').join('\n')}`
    : '';

  const prompt = `You are classifying code review findings to determine if they could be caught by a static analysis linter (like flake8, pylint, or ESLint).

Finding pattern: "${cluster.pattern}"
Severity: ${cluster.severity}
Occurred ${cluster.runCount} times across these skills: ${cluster.skills.join(', ')}

Sample titles:
${cluster.titles.slice(0, 3).map((t) => `- ${t}`).join('\n')}

Sample descriptions:
${cluster.descriptions.map((d) => `- ${d.slice(0, 200)}`).join('\n')}

File paths: ${cluster.paths.slice(0, 5).join(', ')}${examples}

Question: Could a static analysis tool (linter) catch this pattern mechanically, using only syntax/AST analysis, without understanding the semantic intent or business logic of the code?

Classify as:
- "lint-catchable": The pattern is structural/syntactic. A linter rule could detect it by examining code structure, naming patterns, import usage, exception handling patterns, etc.
- "semantic": The pattern requires understanding business logic, architectural context, or semantic meaning that a linter cannot determine.

Respond with JSON: {"classification": "lint-catchable" | "semantic", "reasoning": "brief explanation"}`;

  const result = await callHaiku({
    apiKey,
    prompt,
    schema: ClassificationSchema,
  });

  if (!result.success) {
    return { classification: 'semantic', reasoning: `Classification failed: ${result.error}`, usage: result.usage };
  }

  return { classification: result.data.classification, reasoning: result.data.reasoning, usage: result.usage };
}

/**
 * Pass 1: Harvest findings from logs, cluster them, and classify.
 *
 * Returns classified clusters and aggregate usage stats.
 */
export async function harvest(
  logDir: string,
  options: { since?: string; minOccurrences?: number },
  apiKey: string,
  onProgress?: (message: string) => void,
): Promise<{ clusters: FindingCluster[]; usage: UsageStats }> {
  // Read log entries
  onProgress?.('Reading log files...');
  const logEntries = readLogEntries(logDir, options);

  if (logEntries.length === 0) {
    return { clusters: [], usage: emptyUsage() };
  }

  onProgress?.(`Found ${logEntries.length} findings across log files`);

  // Cluster by normalized title
  const rawClusters = clusterFindings(
    logEntries.map((e) => ({ finding: e.finding, skill: e.skill, runId: e.runId })),
    options.minOccurrences ?? 1,
  );

  if (rawClusters.length === 0) {
    onProgress?.('No recurring patterns found (try lowering --min-occurrences)');
    return { clusters: [], usage: emptyUsage() };
  }

  onProgress?.(`Found ${rawClusters.length} recurring patterns, classifying...`);

  // Classify each cluster with Haiku
  const usages: UsageStats[] = [];
  const clusters: FindingCluster[] = [];

  for (const raw of rawClusters) {
    const { classification, reasoning, usage } = await classifyCluster(raw, apiKey);
    usages.push(usage);

    clusters.push({
      ...raw,
      classification,
      classificationReasoning: reasoning,
    });
  }

  const lintCatchable = clusters.filter((c) => c.classification === 'lint-catchable');
  onProgress?.(`Classified: ${lintCatchable.length} lint-catchable, ${clusters.length - lintCatchable.length} semantic`);

  return {
    clusters,
    usage: usages.length > 0 ? aggregateUsage(usages) : emptyUsage(),
  };
}
