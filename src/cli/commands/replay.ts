import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SkillReport } from '../../types/index.js';
import type { CLIOptions } from '../args.js';
import { renderTerminalReport, filterReports } from '../terminal.js';
import type { Reporter } from '../output/index.js';
import {
  Verbosity,
  JsonlRecordSchema,
  JsonlSummaryRecordSchema,
  pluralize,
} from '../output/index.js';
import type { JsonlRecord, JsonlSummaryRecord } from '../output/index.js';
import {
  collectFixableFindings,
  applyAllFixes,
  runInteractiveFixFlow,
  renderFixSummary,
} from '../fix.js';

/**
 * Parse a JSONL log file and extract skill records and the summary record.
 * Returns the parsed skill records and an optional summary record.
 */
function parseJsonlFile(filePath: string): {
  records: JsonlRecord[];
  summary?: JsonlSummaryRecord;
} {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  const records: JsonlRecord[] = [];
  let summary: JsonlSummaryRecord | undefined;

  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    // Check if this is a summary record
    if (parsed['type'] === 'summary') {
      const result = JsonlSummaryRecordSchema.safeParse(parsed);
      if (result.success) {
        summary = result.data;
      }
      continue;
    }

    // Check if this is a fix-evaluation record (skip it for replay)
    if (parsed['type'] === 'fix-evaluation') {
      continue;
    }

    // Try to parse as a skill record
    const result = JsonlRecordSchema.safeParse(parsed);
    if (result.success) {
      records.push(result.data);
    }
  }

  return { records, summary };
}

/**
 * Convert a JSONL skill record back into a SkillReport for rendering.
 */
function recordToReport(record: JsonlRecord): SkillReport {
  return {
    skill: record.skill,
    summary: record.summary,
    findings: record.findings,
    metadata: record.metadata,
    durationMs: record.durationMs,
    usage: record.usage,
    auxiliaryUsage: record.auxiliaryUsage,
    skippedFiles: record.skippedFiles,
    failedHunks: record.failedHunks,
    failedExtractions: record.failedExtractions,
    files: record.files?.map((f) => ({
      filename: f.filename,
      findingCount: f.findings,
      durationMs: f.durationMs,
      usage: f.usage,
    })),
  };
}

/**
 * Run the replay command.
 * Reads JSONL log files and renders the results as if Warden had just run.
 */
export async function runReplay(options: CLIOptions, reporter: Reporter): Promise<number> {
  const files = options.targets;

  if (!files || files.length === 0) {
    reporter.error('No log files specified');
    reporter.tip('Usage: warden replay <file.jsonl> [file2.jsonl ...]');
    return 1;
  }

  // Resolve and validate file paths
  const cwd = process.cwd();
  const resolvedFiles: string[] = [];
  for (const file of files) {
    const resolved = resolve(cwd, file);
    if (!existsSync(resolved)) {
      reporter.error(`Log file not found: ${file}`);
      return 1;
    }
    resolvedFiles.push(resolved);
  }

  // Parse all JSONL files
  const allReports: SkillReport[] = [];
  let totalDurationMs = 0;

  for (const filePath of resolvedFiles) {
    try {
      const { records, summary } = parseJsonlFile(filePath);

      for (const record of records) {
        allReports.push(recordToReport(record));
      }

      if (summary) {
        totalDurationMs = Math.max(totalDurationMs, summary.run.durationMs);
      }
    } catch (err) {
      reporter.error(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (allReports.length === 0) {
    reporter.warning('No skill results found in the provided log files');
    return 0;
  }

  reporter.step(
    `Replaying ${allReports.length} ${pluralize(allReports.length, 'result')} from ${resolvedFiles.length} ${pluralize(resolvedFiles.length, 'file')}`
  );

  // Apply filtering
  const filteredReports = filterReports(allReports, options.reportOn, options.minConfidence);

  // Collect fixable findings for interactive step-through
  const fixableFindings = collectFixableFindings(filteredReports);
  const willStepThrough = fixableFindings.length > 0
    && !options.json
    && !options.fix
    && reporter.verbosity !== Verbosity.Quiet
    && reporter.mode.isTTY
    && process.stdin.isTTY;

  // Output results
  reporter.blank();
  if (options.json) {
    // --json: re-read and output the raw JSONL content
    for (const filePath of resolvedFiles) {
      const content = readFileSync(filePath, 'utf-8');
      process.stdout.write(content);
    }
  } else {
    console.log(renderTerminalReport(filteredReports, reporter.mode, {
      suppressFixDiffs: willStepThrough,
      verbosity: reporter.verbosity,
    }));
  }

  // Show summary
  reporter.blank();
  reporter.renderSummary(filteredReports, totalDurationMs);

  // Handle fixes
  if (fixableFindings.length > 0) {
    if (options.fix) {
      const fixSummary = applyAllFixes(fixableFindings);
      renderFixSummary(fixSummary, reporter);
    } else if (willStepThrough) {
      const fixSummary = await runInteractiveFixFlow(fixableFindings, reporter);
      renderFixSummary(fixSummary, reporter);
    }
  }

  return 0;
}
