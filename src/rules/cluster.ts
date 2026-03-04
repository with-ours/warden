import { randomUUID } from 'node:crypto';
import type { Finding, Severity } from '../types/index.js';
import type { RawCluster } from './types.js';

/**
 * Normalize a finding title for clustering.
 * Lowercases, strips code tokens, numbers, hashes, and excess whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove inline code blocks
    .replace(/`[^`]+`/g, '')
    // Remove hex hashes (e.g., commit SHAs)
    .replace(/\b[0-9a-f]{7,}\b/g, '')
    // Remove numbers that look like line references or IDs
    .replace(/\b\d+\b/g, '')
    // Remove file paths
    .replace(/\S+\.\w{1,5}/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

interface ClusterInput {
  finding: Finding;
  skill: string;
  runId: string;
}

/**
 * Group findings into clusters by normalized title.
 * Returns clusters that appear in at least `minOccurrences` distinct runs.
 */
export function clusterFindings(
  inputs: ClusterInput[],
  minOccurrences: number
): RawCluster[] {
  const groups = new Map<string, {
    findings: Finding[];
    skills: Set<string>;
    runIds: Set<string>;
  }>();

  for (const { finding, skill, runId } of inputs) {
    const pattern = normalizeTitle(finding.title);
    if (!pattern) continue;

    let group = groups.get(pattern);
    if (!group) {
      group = { findings: [], skills: new Set(), runIds: new Set() };
      groups.set(pattern, group);
    }

    group.findings.push(finding);
    group.skills.add(skill);
    group.runIds.add(runId);
  }

  const clusters: RawCluster[] = [];

  for (const [pattern, group] of groups) {
    if (group.runIds.size < minOccurrences) continue;

    // Determine most common severity
    const sevCounts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const f of group.findings) {
      sevCounts[f.severity]++;
    }
    const sorted = (Object.entries(sevCounts) as [Severity, number][])
      .sort((a, b) => b[1] - a[1]);
    const severity = sorted[0]?.[0] ?? 'medium';

    // Collect unique titles
    const titles = [...new Set(group.findings.map((f) => f.title))];

    // Sample descriptions (max 3, deduplicated)
    const descriptions = [...new Set(group.findings.map((f) => f.description))]
      .slice(0, 3);

    // Collect file paths
    const paths = [...new Set(
      group.findings
        .map((f) => f.location?.path)
        .filter((p): p is string => p !== undefined)
    )];

    // Collect code examples from descriptions/verification (max 5)
    const codeExamples = extractCodeExamples(group.findings).slice(0, 5);

    clusters.push({
      id: randomUUID().slice(0, 8),
      pattern,
      severity,
      skills: [...group.skills],
      runCount: group.runIds.size,
      titles,
      descriptions,
      paths,
      codeExamples,
    });
  }

  // Sort by run count descending, then by severity
  const sevOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  clusters.sort((a, b) => {
    const runDiff = b.runCount - a.runCount;
    if (runDiff !== 0) return runDiff;
    return sevOrder[a.severity] - sevOrder[b.severity];
  });

  return clusters;
}

/**
 * Extract code snippets from finding descriptions and verification fields.
 * Looks for markdown code blocks and indented code.
 */
function extractCodeExamples(findings: Finding[]): string[] {
  const examples: string[] = [];
  const seen = new Set<string>();

  for (const f of findings) {
    const sources = [f.description, f.verification].filter(Boolean);
    for (const text of sources) {
      if (!text) continue;
      // Match fenced code blocks
      const codeBlocks = text.matchAll(/```[\w]*\n([\s\S]*?)```/g);
      for (const match of codeBlocks) {
        const code = (match[1] ?? '').trim();
        if (code && !seen.has(code)) {
          seen.add(code);
          examples.push(code);
        }
      }
    }
  }

  return examples;
}
