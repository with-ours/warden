import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import type { Reporter } from '../output/reporter.js';
import type { CLIOptions } from '../args.js';
import {
  parseJsonlFiles,
  renderJsonlString,
  pluralize,
} from '../output/index.js';
import { renderTerminalReport, filterReports } from '../terminal.js';

/**
 * Run the replay command.
 * Reads JSONL log files and renders their results using the interactive UI.
 */
export async function runReplay(options: CLIOptions, reporter: Reporter): Promise<number> {
  const targets = options.targets ?? [];

  if (targets.length === 0) {
    reporter.error('No log files specified');
    reporter.tip('Usage: warden replay <file.jsonl> [file2.jsonl ...]');
    return 1;
  }

  // Expand glob patterns and resolve paths
  const cwd = process.cwd();
  const resolvedPaths: string[] = [];

  for (const target of targets) {
    // Check if target contains glob characters
    if (target.includes('*') || target.includes('?') || target.includes('[')) {
      const matches = await fg(target, { cwd, absolute: true });
      if (matches.length === 0) {
        reporter.warning(`No files matched pattern: ${target}`);
      }
      resolvedPaths.push(...matches);
    } else {
      const resolved = resolve(cwd, target);
      if (!existsSync(resolved)) {
        reporter.error(`File not found: ${target}`);
        return 1;
      }
      resolvedPaths.push(resolved);
    }
  }

  if (resolvedPaths.length === 0) {
    reporter.error('No log files found');
    return 1;
  }

  // Sort files by path for consistent ordering
  resolvedPaths.sort();

  reporter.step(`Replaying ${resolvedPaths.length} ${pluralize(resolvedPaths.length, 'log file')}...`);

  // Parse all JSONL files
  let parsed;
  try {
    parsed = parseJsonlFiles(resolvedPaths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.error(`Failed to parse log files: ${message}`);
    return 1;
  }

  if (parsed.reports.length === 0) {
    reporter.warning('No skill results found in log files');
    return 0;
  }

  reporter.success(`Found ${parsed.reports.length} ${pluralize(parsed.reports.length, 'skill result')}`);

  // Apply filtering
  const filteredReports = filterReports(parsed.reports, options.reportOn, options.minConfidence);

  // Output results
  reporter.blank();
  if (options.json) {
    // Output as JSONL, reconstructing from the parsed reports
    const durationMs = parsed.summary?.run.durationMs ?? 0;
    const jsonlContent = renderJsonlString(filteredReports, durationMs, {
      runId: parsed.runMetadata?.runId,
      traceId: parsed.runMetadata?.traceId,
    });
    process.stdout.write(jsonlContent);
  } else {
    // Render terminal report
    console.log(renderTerminalReport(filteredReports, reporter.mode, { verbosity: reporter.verbosity }));
  }

  // Show summary
  reporter.blank();
  reporter.renderSummary(filteredReports, parsed.summary?.run.durationMs ?? 0, {
    traceId: parsed.runMetadata?.traceId,
  });

  return 0;
}
