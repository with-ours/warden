import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { Severity, SkillReport, Finding } from './types/index.js';
import { SEVERITY_ORDER } from './types/index.js';
import { getVersion } from './utils/index.js';

export type SentryContext = 'cli' | 'action';
export type FindingTelemetryStage =
  | 'initial'
  | 'report_deduped'
  | 'report_merged'
  | 'report_final'
  | 'review_filtered'
  | 'review_consolidated'
  | 'review_deduped'
  | 'review_posted';

type SpanAttributeValue =
  | string
  | number
  | boolean
  | (string | null | undefined)[]
  | (number | null | undefined)[]
  | (boolean | null | undefined)[];

type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

interface SpanLike {
  setAttributes(attributes: SpanAttributes): unknown;
  spanContext(): { traceId: string; spanId: string };
}

export interface ActiveSpanIds {
  traceId: string;
  spanId: string;
}

export interface FindingTelemetryContext {
  skill?: string;
  triggerName?: string;
  parentTraceId?: string;
  parentSpanId?: string;
}

let initialized = false;

export function initSentry(context: SentryContext): void {
  const dsn = process.env['WARDEN_SENTRY_DSN'];
  if (!dsn || initialized) return;
  initialized = true;

  Sentry.init({
    dsn,
    release: `warden@${getVersion()}`,
    environment: context === 'action' ? 'github-action' : 'cli',
    tracesSampleRate: 1.0,
    enableLogs: true,
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      Sentry.anthropicAIIntegration({ recordInputs: true, recordOutputs: true }),
      Sentry.httpIntegration(),
    ],
  });

  Sentry.setTag('service.version', getVersion());
  Sentry.getGlobalScope().setAttributes({
    'warden.source': context === 'action' ? 'github-action' : 'cli',
  });
}

export { Sentry };
export const { logger } = Sentry;

/**
 * Set attributes on the global Sentry scope.
 * These automatically apply to ALL metrics and spans.
 */
export function setGlobalAttributes(attrs: Record<string, string | number | boolean>): void {
  if (!initialized) return;
  try {
    Sentry.getGlobalScope().setAttributes(attrs);
  } catch {
    // Never break the workflow
  }
}

/**
 * Get the trace ID from the active span, if available.
 * Useful for correlating runs to Sentry traces in logs and output.
 */
export function getTraceId(): string | undefined {
  return getActiveSpanIds()?.traceId;
}

export function getActiveSpanIds(): ActiveSpanIds | undefined {
  if (!initialized) return undefined;
  try {
    const context = Sentry.getActiveSpan()?.spanContext();
    if (!context) return undefined;
    return { traceId: context.traceId, spanId: context.spanId };
  } catch {
    return undefined;
  }
}

export function getFindingFingerprint(finding: Finding): string {
  const location = finding.location
    ? `${finding.location.path}:${finding.location.startLine}:${finding.location.endLine ?? ''}`
    : 'general';
  return createHash('sha1')
    .update([
      location,
      finding.severity,
      finding.confidence ?? '',
      finding.title,
      finding.description,
    ].join('\n'))
    .digest('hex');
}

function buildFindingStageAttributes(
  stage: FindingTelemetryStage,
  findings: Finding[],
  context: FindingTelemetryContext = {},
  spanIds?: ActiveSpanIds
): SpanAttributes {
  const attrs: SpanAttributes = {
    'warden.findings.stage': stage,
    'warden.findings.count': findings.length,
    'warden.findings.trace_id': spanIds?.traceId,
    'warden.findings.span_id': spanIds?.spanId,
    'warden.findings.parent_trace_id': context.parentTraceId,
    'warden.findings.parent_span_id': context.parentSpanId,
    'warden.findings.skill': context.skill,
    'warden.findings.trigger_name': context.triggerName,
  };

  findings.forEach((finding, index) => {
    const prefix = `warden.findings.${index}`;
    attrs[`${prefix}.id`] = finding.id;
    attrs[`${prefix}.fingerprint`] = getFindingFingerprint(finding);
    attrs[`${prefix}.severity`] = finding.severity;
    attrs[`${prefix}.confidence`] = finding.confidence;
    attrs[`${prefix}.title`] = finding.title;
    attrs[`${prefix}.description`] = finding.description;
    attrs[`${prefix}.verification`] = finding.verification;
    attrs[`${prefix}.elapsed_ms`] = finding.elapsedMs;
    attrs[`${prefix}.location.path`] = finding.location?.path;
    attrs[`${prefix}.location.start_line`] = finding.location?.startLine;
    attrs[`${prefix}.location.end_line`] = finding.location?.endLine;
    attrs[`${prefix}.suggested_fix.description`] = finding.suggestedFix?.description;
    attrs[`${prefix}.suggested_fix.diff`] = finding.suggestedFix?.diff;
    attrs[`${prefix}.additional_locations.count`] = finding.additionalLocations?.length ?? 0;

    finding.additionalLocations?.forEach((location, locationIndex) => {
      const locationPrefix = `${prefix}.additional_locations.${locationIndex}`;
      attrs[`${locationPrefix}.path`] = location.path;
      attrs[`${locationPrefix}.start_line`] = location.startLine;
      attrs[`${locationPrefix}.end_line`] = location.endLine;
    });
  });

  return attrs;
}

export function setFindingStageAttributes(
  span: SpanLike,
  stage: FindingTelemetryStage,
  findings: Finding[],
  context: FindingTelemetryContext = {}
): void {
  try {
    span.setAttributes(buildFindingStageAttributes(stage, findings, context, span.spanContext()));
  } catch {
    // Never break the workflow
  }
}

export function captureFindingStage(
  stage: FindingTelemetryStage,
  findings: Finding[],
  context: FindingTelemetryContext = {}
): void {
  if (!initialized) return;

  try {
    const parentSpanIds = getActiveSpanIds();
    Sentry.startSpan(
      {
        op: 'warden.findings',
        name: `findings ${stage}`,
      },
      (span) => {
        setFindingStageAttributes(span, stage, findings, {
          ...context,
          parentTraceId: parentSpanIds?.traceId,
          parentSpanId: parentSpanIds?.spanId,
        });
      },
    );
  } catch {
    // Never break the workflow
  }
}

/**
 * Run a metrics callback only when Sentry is initialized.
 * Swallows errors so metrics never break the main workflow.
 */
function safeEmit(fn: () => void): void {
  if (!initialized) return;
  try {
    fn();
  } catch {
    // Metrics emission should never break the main workflow
  }
}

/**
 * Emit a single run count. Call once per analysis workflow execution.
 * Inherits warden.source and warden.repository from global scope.
 */
export function emitRunMetric(): void {
  safeEmit(() => {
    Sentry.metrics.count('workflow.runs', 1);
  });
}

export function emitSkillMetrics(report: SkillReport): void {
  safeEmit(() => {
    const attrs: Record<string, string> = { skill: report.skill };
    if (report.model) {
      attrs['model'] = report.model;
    }

    Sentry.metrics.distribution('skill.duration', report.durationMs ?? 0, {
      unit: 'millisecond',
      attributes: attrs,
    });

    if (report.usage) {
      Sentry.metrics.distribution('tokens.input', report.usage.inputTokens, {
        unit: 'none',
        attributes: attrs,
      });
      Sentry.metrics.distribution('tokens.output', report.usage.outputTokens, {
        unit: 'none',
        attributes: attrs,
      });
      if (report.usage.costUSD) {
        Sentry.metrics.distribution('cost.usd', report.usage.costUSD, { attributes: attrs });
      }
    }

    Sentry.metrics.count('findings.total', report.findings.length, { attributes: attrs });
    for (const severity of Object.keys(SEVERITY_ORDER) as Severity[]) {
      const count = report.findings.filter((f) => f.severity === severity).length;
      if (count > 0) {
        Sentry.metrics.count('findings', count, {
          attributes: { ...attrs, severity },
        });
      }
    }
  });
}

export function emitExtractionMetrics(skill: string, method: 'regex' | 'llm' | 'none', count: number): void {
  safeEmit(() => {
    const attrs = { skill, method };
    Sentry.metrics.count('extraction.attempts', 1, { attributes: attrs });
    Sentry.metrics.count('extraction.findings', count, { attributes: attrs });
  });
}

export function emitFixEvalMetrics(
  evaluated: number,
  resolved: number,
  failed: number,
  skipped: number,
  uniqueFindingsEvaluated: number,
  uniqueFindingsCodeChanged: number,
  uniqueFindingsResolved: number
): void {
  safeEmit(() => {
    Sentry.metrics.count('warden.fix_eval.evaluated', evaluated);
    Sentry.metrics.count('warden.fix_eval.resolved', resolved);
    Sentry.metrics.count('warden.fix_eval.failed', failed);
    Sentry.metrics.count('warden.fix_eval.skipped', skipped);
    Sentry.metrics.count('warden.fix_eval.unique_findings.evaluated', uniqueFindingsEvaluated);
    Sentry.metrics.count('warden.fix_eval.unique_findings.code_changed', uniqueFindingsCodeChanged);
    Sentry.metrics.count('warden.fix_eval.unique_findings.resolved', uniqueFindingsResolved);
  });
}

export function emitFixGateMetrics(
  skill: string,
  checked: number,
  strippedDeterministic: number,
  strippedSemantic: number,
  semanticUnavailable: number
): void {
  safeEmit(() => {
    const attrs = { skill };
    Sentry.metrics.count('fix_gate.checked', checked, { attributes: attrs });
    Sentry.metrics.count('fix_gate.stripped_deterministic', strippedDeterministic, { attributes: attrs });
    Sentry.metrics.count('fix_gate.stripped_semantic', strippedSemantic, { attributes: attrs });
    Sentry.metrics.count('fix_gate.semantic_unavailable', semanticUnavailable, { attributes: attrs });
  });
}

export function emitRetryMetric(skill: string, attempt: number): void {
  safeEmit(() => {
    Sentry.metrics.count('skill.retries', 1, { attributes: { skill, attempt } });
  });
}

export function emitDedupMetrics(skill: string, total: number, unique: number): void {
  safeEmit(() => {
    const attrs = { skill };
    Sentry.metrics.distribution('dedup.total', total, { attributes: attrs });
    Sentry.metrics.distribution('dedup.unique', unique, { attributes: attrs });
    if (total > 0) {
      Sentry.metrics.distribution('dedup.removed', total - unique, { attributes: attrs });
    }
  });
}

export function emitFixEvalVerdictMetric(verdict: string, skill?: string): void {
  safeEmit(() => {
    const attrs: Record<string, string> = { verdict };
    if (skill) {
      attrs['skill'] = skill;
    }
    Sentry.metrics.count('warden.fix_eval.verdict', 1, { attributes: attrs });
  });
}

export function emitStaleResolutionMetric(count: number, skill?: string): void {
  safeEmit(() => {
    const attrs: Record<string, string> | undefined = skill ? { skill } : undefined;
    Sentry.metrics.count('warden.stale.resolved', count, attrs ? { attributes: attrs } : undefined);
  });
}

/**
 * Flush pending Sentry events. Safe to call even if Sentry is not initialized.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Sentry flush failure should not prevent normal operation
  }
}
