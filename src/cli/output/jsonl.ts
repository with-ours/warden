import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  UsageStatsSchema,
  FindingSchema,
  SkippedFileSchema,
  AuxiliaryUsageMapSchema,
  SeveritySchema,
  FixStatusSchema,
} from '../../types/index.js';
import type { SkillReport, UsageStats, AuxiliaryUsageMap } from '../../types/index.js';
import { mergeAuxiliaryUsage } from '../../sdk/usage.js';
import { countBySeverity } from './formatters.js';

/**
 * Generate a unique run ID for this execution.
 */
export function generateRunId(): string {
  return randomUUID();
}

/**
 * Get the first 8 hex chars (no dashes) of a UUID for use in filenames.
 */
export function shortRunId(runId: string): string {
  return runId.replace(/-/g, '').slice(0, 8);
}

/**
 * Get the repo-local log file path.
 * Returns: {repoRoot}/.warden/logs/{ISO-datetime}-{runId8}.jsonl
 */
export function getRepoLogPath(repoRoot: string, runId: string, timestamp: Date = new Date()): string {
  const ts = timestamp.toISOString().replace(/:/g, '-');
  return join(repoRoot, '.warden', 'logs', `${ts}-${shortRunId(runId)}.jsonl`);
}

/**
 * JSONL record schemas for Warden's structured run output.
 *
 * Formal JSON Schema: specs/jsonl-schema.json
 * Example payloads:   specs/jsonl-examples.jsonl
 * Reporter spec:      specs/reporters.md Section 3 "JSONL Specification"
 */

/** Metadata common to every JSONL record. */
export const JsonlRunMetadataSchema = z.object({
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  cwd: z.string(),
  runId: z.string(),
  traceId: z.string().optional(),
});
export type JsonlRunMetadata = z.infer<typeof JsonlRunMetadataSchema>;

/** Per-file breakdown within a skill record. */
export const JsonlFileRecordSchema = z.object({
  filename: z.string(),
  findings: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  usage: UsageStatsSchema.optional(),
});
export type JsonlFileRecord = z.infer<typeof JsonlFileRecordSchema>;

/** One skill's analysis results. */
export const JsonlRecordSchema = z.object({
  run: JsonlRunMetadataSchema,
  skill: z.string(),
  summary: z.string(),
  findings: z.array(FindingSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().nonnegative().optional(),
  usage: UsageStatsSchema.optional(),
  auxiliaryUsage: AuxiliaryUsageMapSchema.optional(),
  files: z.array(JsonlFileRecordSchema).optional(),
  skippedFiles: z.array(SkippedFileSchema).optional(),
  failedHunks: z.number().int().nonnegative().optional(),
  failedExtractions: z.number().int().nonnegative().optional(),
});
export type JsonlRecord = z.infer<typeof JsonlRecordSchema>;

/** Severity breakdown in the summary record. */
const BySeveritySchema = z.record(SeveritySchema, z.number().int().nonnegative());

/**
 * More permissive schema for parsing bySeverity from log files.
 * Log files may not include all severity keys, only those with non-zero counts.
 */
const BySeverityParseSchema = z.record(z.string(), z.number().int().nonnegative());

/** Aggregate summary across all skills (always the last JSONL line). */
export const JsonlSummaryRecordSchema = z.object({
  run: JsonlRunMetadataSchema,
  type: z.literal('summary'),
  totalFindings: z.number().int().nonnegative(),
  bySeverity: BySeveritySchema,
  usage: UsageStatsSchema.optional(),
  totalSkippedFiles: z.number().int().nonnegative().optional(),
  auxiliaryUsage: AuxiliaryUsageMapSchema.optional(),
});
export type JsonlSummaryRecord = z.infer<typeof JsonlSummaryRecordSchema>;

/** Permissive schema for parsing summary records from log files. */
const JsonlSummaryRecordParseSchema = z.object({
  run: JsonlRunMetadataSchema,
  type: z.literal('summary'),
  totalFindings: z.number().int().nonnegative(),
  bySeverity: BySeverityParseSchema,
  usage: UsageStatsSchema.optional(),
  totalSkippedFiles: z.number().int().nonnegative().optional(),
  auxiliaryUsage: AuxiliaryUsageMapSchema.optional(),
});

/** Per-evaluation detail for fix evaluation records. */
export const JsonlFixEvalDetailSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  findingId: z.string().optional(),
  verdict: z.union([FixStatusSchema, z.literal('re_detected')]),
  reasoning: z.string().optional(),
  durationMs: z.number().nonnegative(),
  usage: UsageStatsSchema,
});
export type JsonlFixEvalDetail = z.infer<typeof JsonlFixEvalDetailSchema>;

/** Fix evaluation results record. */
export const JsonlFixEvaluationRecordSchema = z.object({
  run: JsonlRunMetadataSchema,
  type: z.literal('fix-evaluation'),
  evaluated: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failedEvaluations: z.number().int().nonnegative(),
  usage: UsageStatsSchema.optional(),
  evaluations: z.array(JsonlFixEvalDetailSchema).optional(),
});
export type JsonlFixEvaluationRecord = z.infer<typeof JsonlFixEvaluationRecordSchema>;

/**
 * Aggregate usage stats from reports.
 */
function aggregateUsage(reports: SkillReport[]): UsageStats | undefined {
  const usages = reports.map((r) => r.usage).filter((u) => u !== undefined);
  if (usages.length === 0) return undefined;

  return usages.reduce((acc, u) => ({
    inputTokens: acc.inputTokens + u.inputTokens,
    outputTokens: acc.outputTokens + u.outputTokens,
    cacheReadInputTokens: (acc.cacheReadInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens: (acc.cacheCreationInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0),
    costUSD: acc.costUSD + u.costUSD,
  }));
}

/**
 * Render skill reports as a JSONL string.
 * Each line contains one skill report with run metadata.
 * A final summary line is appended at the end.
 */
export function renderJsonlString(
  reports: SkillReport[],
  durationMs: number,
  options?: { runId?: string; traceId?: string; timestamp?: Date }
): string {
  const timestamp = (options?.timestamp ?? new Date()).toISOString();
  const cwd = process.cwd();

  const runMetadata: JsonlRunMetadata = {
    timestamp,
    durationMs,
    cwd,
    runId: options?.runId ?? generateRunId(),
    traceId: options?.traceId,
  };

  const lines: string[] = [];

  for (const report of reports) {
    const record: JsonlRecord = {
      run: runMetadata,
      skill: report.skill,
      summary: report.summary,
      findings: report.findings,
      metadata: report.metadata,
      durationMs: report.durationMs,
      usage: report.usage,
      auxiliaryUsage: report.auxiliaryUsage,
      files: report.files?.map((f) => ({
        filename: f.filename,
        findings: f.findingCount,
        durationMs: f.durationMs,
        usage: f.usage,
      })),
      skippedFiles: report.skippedFiles?.length ? report.skippedFiles : undefined,
      failedHunks: report.failedHunks || undefined,
      failedExtractions: report.failedExtractions || undefined,
    };
    lines.push(JSON.stringify(record));
  }

  const allFindings = reports.flatMap((r) => r.findings);
  const totalSkippedFiles = reports.reduce((n, r) => n + (r.skippedFiles?.length ?? 0), 0);
  const totalAuxiliaryUsage = reports.reduce<AuxiliaryUsageMap | undefined>(
    (acc, r) => mergeAuxiliaryUsage(acc, r.auxiliaryUsage),
    undefined
  );
  const summaryRecord: JsonlSummaryRecord = {
    run: runMetadata,
    type: 'summary',
    totalFindings: allFindings.length,
    bySeverity: countBySeverity(allFindings),
    usage: aggregateUsage(reports),
    totalSkippedFiles: totalSkippedFiles > 0 ? totalSkippedFiles : undefined,
    auxiliaryUsage: totalAuxiliaryUsage,
  };
  lines.push(JSON.stringify(summaryRecord));

  return lines.join('\n') + '\n';
}

/**
 * Write skill reports to a JSONL file.
 */
export function writeJsonlReport(
  outputPath: string,
  reports: SkillReport[],
  durationMs: number,
  options?: { runId?: string; traceId?: string }
): void {
  const resolvedPath = resolve(process.cwd(), outputPath);
  const content = renderJsonlString(reports, durationMs, options);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content);
}

/**
 * Write pre-rendered JSONL content to a file path.
 */
export function writeJsonlContent(outputPath: string, content: string): void {
  const resolvedPath = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content);
}

/**
 * Read a JSONL log file and return its contents.
 */
export function readJsonlLog(logPath: string): string {
  return readFileSync(logPath, 'utf-8');
}

/**
 * Result of parsing JSONL log files.
 */
export interface ParsedJsonlLog {
  reports: SkillReport[];
  summary?: JsonlSummaryRecord;
  runMetadata?: JsonlRunMetadata;
}

/**
 * Parse JSONL content and extract skill reports.
 * Returns SkillReports reconstructed from JsonlRecords.
 */
export function parseJsonlContent(content: string): ParsedJsonlLog {
  const lines = content.trim().split('\n').filter((line) => line.trim());
  const reports: SkillReport[] = [];
  let summary: JsonlSummaryRecord | undefined;
  let runMetadata: JsonlRunMetadata | undefined;

  for (const line of lines) {
    const parsed = JSON.parse(line);

    // Check if this is a summary record
    if (parsed.type === 'summary') {
      const result = JsonlSummaryRecordParseSchema.safeParse(parsed);
      if (result.success) {
        // Cast to JsonlSummaryRecord since the parse schema is compatible
        summary = result.data as JsonlSummaryRecord;
        runMetadata = result.data.run;
      }
      continue;
    }

    // Check if this is a fix-evaluation record (skip for now)
    if (parsed.type === 'fix-evaluation') {
      continue;
    }

    // Otherwise treat as a skill record
    const result = JsonlRecordSchema.safeParse(parsed);
    if (!result.success) {
      continue;
    }

    const record = result.data;
    runMetadata = record.run;

    // Convert JsonlRecord to SkillReport
    const report: SkillReport = {
      skill: record.skill,
      summary: record.summary,
      findings: record.findings,
      metadata: record.metadata,
      durationMs: record.durationMs,
      usage: record.usage,
      auxiliaryUsage: record.auxiliaryUsage,
      files: record.files?.map((f) => ({
        filename: f.filename,
        findingCount: f.findings,
        durationMs: f.durationMs,
        usage: f.usage,
      })),
      skippedFiles: record.skippedFiles,
      failedHunks: record.failedHunks,
      failedExtractions: record.failedExtractions,
    };

    reports.push(report);
  }

  return { reports, summary, runMetadata };
}

/**
 * Parse multiple JSONL log files and merge their reports.
 * Returns all skill reports from all files.
 */
export function parseJsonlFiles(logPaths: string[]): ParsedJsonlLog {
  const allReports: SkillReport[] = [];
  let lastSummary: JsonlSummaryRecord | undefined;
  let lastRunMetadata: JsonlRunMetadata | undefined;

  for (const logPath of logPaths) {
    const content = readJsonlLog(logPath);
    const parsed = parseJsonlContent(content);
    allReports.push(...parsed.reports);
    if (parsed.summary) {
      lastSummary = parsed.summary;
    }
    if (parsed.runMetadata) {
      lastRunMetadata = parsed.runMetadata;
    }
  }

  return { reports: allReports, summary: lastSummary, runMetadata: lastRunMetadata };
}
