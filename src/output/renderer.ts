import { SEVERITY_ORDER, filterFindingsBySeverity } from '../types/index.js';
import type { SkillReport, Finding, Severity, SeverityThreshold } from '../types/index.js';
import type { RenderResult, RenderOptions, GitHubReview, GitHubComment, ReviewState } from './types.js';
import { formatStatsCompact, countBySeverity, pluralize } from '../cli/output/formatters.js';
import { generateContentHash, generateMarker } from './dedup.js';
import { escapeHtml } from '../utils/index.js';

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: ':rotating_light:',
  high: ':warning:',
  medium: ':orange_circle:',
  low: ':large_blue_circle:',
  info: ':information_source:',
};

export function renderSkillReport(report: SkillReport, options: RenderOptions = {}): RenderResult {
  const { includeSuggestions = true, maxFindings, groupByFile = true, commentOn, failOn, checkRunUrl, totalFindings, allFindings, previousReviewState } = options;

  // Filter by commentOn threshold first, then apply maxFindings limit
  const filteredFindings = filterFindingsBySeverity(report.findings, commentOn);
  const findings = maxFindings ? filteredFindings.slice(0, maxFindings) : filteredFindings;
  const sortedFindings = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  // Calculate how many findings were filtered out
  const total = totalFindings ?? report.findings.length;
  const hiddenCount = total - sortedFindings.length;

  // Use allFindings for failOn evaluation if provided (e.g., when report.findings was modified for dedup)
  const findingsForFailOn = allFindings ?? report.findings;
  const review = renderReview(sortedFindings, report, includeSuggestions, failOn, findingsForFailOn, previousReviewState);
  const summaryComment = renderSummaryComment(report, sortedFindings, groupByFile, checkRunUrl, hiddenCount);

  return { review, summaryComment };
}

function renderReview(
  findings: Finding[],
  report: SkillReport,
  includeSuggestions: boolean,
  failOn?: SeverityThreshold,
  allFindings?: Finding[],
  previousReviewState?: ReviewState | null
): GitHubReview | undefined {
  const findingsWithLocation = findings.filter((f) => f.location);

  // Determine review event type based on failOn threshold against ALL findings.
  // Use allFindings (or report.findings) so failOn operates independently of commentOn and deduplication.
  const event = determineReviewEvent(allFindings ?? report.findings, failOn, previousReviewState);

  // If no comments to post, only create a review if REQUEST_CHANGES or APPROVE is needed
  // This ensures failOn can block the PR even when commentOn filters out all findings,
  // and APPROVE can clear a previous REQUEST_CHANGES
  if (findingsWithLocation.length === 0) {
    if (event === 'REQUEST_CHANGES') {
      return {
        event,
        // GitHub API requires non-empty body for REQUEST_CHANGES
        body: 'Findings exceed the configured threshold. See the GitHub Check for details.',
        comments: [],
      };
    }
    if (event === 'APPROVE') {
      return {
        event,
        body: 'All previously reported issues have been resolved.',
        comments: [],
      };
    }
    return undefined;
  }

  const comments: GitHubComment[] = findingsWithLocation.map((finding) => {
    const location = finding.location;
    if (!location) {
      throw new Error('Unexpected: finding without location in filtered list');
    }
    const confidenceNote = finding.confidence ? ` (${finding.confidence} confidence)` : '';
    let body = `**${SEVERITY_EMOJI[finding.severity]} ${escapeHtml(finding.title)}**${confidenceNote}\n\n${escapeHtml(finding.description)}`;

    if (includeSuggestions && finding.suggestedFix) {
      body += `\n\n${renderSuggestion(finding.suggestedFix.description, finding.suggestedFix.diff)}`;
    }

    // Add attribution footnote with skill name, severity, and confidence
    const confidenceSuffix = finding.confidence ? `, ${finding.confidence} confidence` : '';
    body += `\n\n<sub>Identified by Warden via \`${report.skill}\` · ${finding.severity}${confidenceSuffix}</sub>`;

    // Add deduplication marker
    const contentHash = generateContentHash(finding.title, finding.description);
    const line = location.endLine ?? location.startLine;
    body += `\n${generateMarker(location.path, line, contentHash)}`;

    const isMultiLine = location.endLine && location.startLine !== location.endLine;

    return {
      body,
      path: location.path,
      line: location.endLine ?? location.startLine,
      side: 'RIGHT' as const,
      start_line: isMultiLine ? location.startLine : undefined,
      start_side: isMultiLine ? ('RIGHT' as const) : undefined,
    };
  });

  return {
    event,
    body: '',
    comments,
  };
}

/**
 * Determine the PR review event type based on failOn threshold and previous review state.
 * Returns:
 * - REQUEST_CHANGES if failOn is set and findings meet/exceed the threshold
 * - APPROVE if failOn is set, we previously requested changes, and no longer have blocking findings
 * - COMMENT otherwise
 */
function determineReviewEvent(
  findings: Finding[],
  failOn?: SeverityThreshold,
  previousReviewState?: ReviewState | null
): GitHubReview['event'] {
  // failOn must be set (and not 'off') for REQUEST_CHANGES or APPROVE
  const hasActiveThreshold = failOn && failOn !== 'off';

  // Check if any finding meets or exceeds the failOn threshold
  const hasBlockingFinding =
    hasActiveThreshold &&
    findings.some((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[failOn]);

  if (hasBlockingFinding) {
    return 'REQUEST_CHANGES';
  }

  // Only approve if we have an active threshold configured.
  // Without failOn, approval is meaningless (we never would have requested changes).
  if (hasActiveThreshold && previousReviewState === 'CHANGES_REQUESTED') {
    return 'APPROVE';
  }

  return 'COMMENT';
}

/**
 * Render a suggested fix with both a diff preview and a GitHub suggestion block.
 *
 * GitHub suggestion syntax: The ```suggestion block must contain only the replacement
 * content (no diff markers). When the comment is attached to specific line(s), GitHub
 * will offer a "Commit suggestion" button that replaces those lines with the suggestion.
 *
 * @see https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request#adding-line-comments-to-a-pull-request
 */
function renderSuggestion(description: string, diff: string): string {
  const lines = diff.split('\n');

  // Extract removed lines (what's being replaced) - skip diff header lines
  const removedLines = lines
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1));

  // Extract added lines (the replacement content) - skip diff header lines
  const addedLines = lines
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));

  if (addedLines.length === 0) {
    return `**Suggested fix:** ${escapeHtml(description)}`;
  }

  let result = `**Suggested fix:** ${escapeHtml(description)}`;

  // Show a diff block so reviewers can see what's being removed vs added
  if (removedLines.length > 0) {
    result += `\n\n\`\`\`diff\n${removedLines.map((l) => `-${l}`).join('\n')}\n${addedLines.map((l) => `+${l}`).join('\n')}\n\`\`\``;
  }

  // GitHub suggestion block - contains only the replacement content (no diff markers)
  // GitHub's UI will show this as a committable suggestion
  result += `\n\n\`\`\`suggestion\n${addedLines.join('\n')}\n\`\`\``;

  return result;
}

function renderHiddenFindingsLink(hiddenCount: number, checkRunUrl: string): string {
  return `[View ${hiddenCount} additional ${pluralize(hiddenCount, 'finding')} in Checks](${checkRunUrl})`;
}

function renderSummaryComment(
  report: SkillReport,
  findings: Finding[],
  groupByFile: boolean,
  checkRunUrl?: string,
  hiddenCount?: number
): string {
  const lines: string[] = [];

  lines.push(`## ${report.skill}`);
  lines.push('');
  lines.push(escapeHtml(report.summary));
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings to report.');
    // Add link to full report if there are hidden findings
    if (hiddenCount && hiddenCount > 0 && checkRunUrl) {
      lines.push('');
      lines.push(renderHiddenFindingsLink(hiddenCount, checkRunUrl));
    }
    // Add stats footer even when there are no findings
    const statsLine = formatStatsCompact(report.durationMs, report.usage);
    if (statsLine) {
      lines.push('', '---', `<sub>${statsLine}</sub>`);
    }
    return lines.join('\n');
  }

  const counts = countBySeverity(findings);
  lines.push('### Summary');
  lines.push('');
  lines.push(
    `| Severity | Count |
|----------|-------|
${Object.entries(counts)
  .filter(([, count]) => count > 0)
  .sort(([a], [b]) => SEVERITY_ORDER[a as Severity] - SEVERITY_ORDER[b as Severity])
  .map(([severity, count]) => `| ${SEVERITY_EMOJI[severity as Severity]} ${severity} | ${count} |`)
  .join('\n')}`
  );
  lines.push('');

  lines.push('### Findings');
  lines.push('');

  if (groupByFile) {
    const byFile = groupFindingsByFile(findings);
    for (const [file, fileFindings] of Object.entries(byFile)) {
      lines.push(`#### \`${file}\``);
      lines.push('');
      for (const finding of fileFindings) {
        lines.push(renderFindingItem(finding));
      }
      lines.push('');
    }

    const noLocation = findings.filter((f) => !f.location);
    if (noLocation.length > 0) {
      lines.push('#### General');
      lines.push('');
      for (const finding of noLocation) {
        lines.push(renderFindingItem(finding));
      }
    }
  } else {
    for (const finding of findings) {
      lines.push(renderFindingItem(finding));
    }
  }

  // Add link to full report if there are hidden findings
  if (hiddenCount && hiddenCount > 0 && checkRunUrl) {
    lines.push('');
    lines.push(renderHiddenFindingsLink(hiddenCount, checkRunUrl));
  }

  // Add stats footer
  const statsLine = formatStatsCompact(report.durationMs, report.usage);
  if (statsLine) {
    lines.push('', '---', `<sub>${statsLine}</sub>`);
  }

  return lines.join('\n');
}

function formatLineRange(loc: { startLine: number; endLine?: number }): string {
  if (loc.endLine) {
    return `L${loc.startLine}-${loc.endLine}`;
  }
  return `L${loc.startLine}`;
}

function renderFindingItem(finding: Finding): string {
  const location = finding.location ? ` (${formatLineRange(finding.location)})` : '';
  const confidence = finding.confidence ? ` [${finding.confidence} confidence]` : '';
  return `- ${SEVERITY_EMOJI[finding.severity]} **${escapeHtml(finding.title)}**${location}${confidence}: ${escapeHtml(finding.description)}`;
}

function groupFindingsByFile(findings: Finding[]): Record<string, Finding[]> {
  const groups: Record<string, Finding[]> = {};
  for (const finding of findings) {
    if (finding.location) {
      const path = finding.location.path;
      groups[path] ??= [];
      groups[path].push(finding);
    }
  }
  return groups;
}
