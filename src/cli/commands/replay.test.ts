import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runReplay } from './replay.js';
import { Reporter, parseVerbosity } from '../output/index.js';
import type { CLIOptions } from '../args.js';

function makeReporter(overrides?: { quiet?: boolean; verbose?: number }): Reporter {
  const mode = { isTTY: false, supportsColor: false, columns: 80 };
  const verbosity = parseVerbosity(overrides?.quiet ?? false, overrides?.verbose ?? 0, false);
  return new Reporter(mode, verbosity);
}

function defaultOptions(overrides: Partial<CLIOptions> = {}): CLIOptions {
  return {
    json: false,
    help: false,
    quiet: false,
    verbose: 0,
    debug: false,
    log: false,
    fix: false,
    force: false,
    list: false,
    git: false,
    offline: false,
    failFast: false,
    ...overrides,
  };
}

/** Build a minimal JSONL skill record. */
function skillRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run: {
      timestamp: '2026-02-08T14:30:45.123Z',
      durationMs: 3000,
      cwd: '/tmp/test',
      runId: randomUUID(),
    },
    skill: 'test-skill',
    summary: 'test-skill: Found 1 issue (1 high)',
    findings: [
      {
        id: 'TEST-001',
        severity: 'high',
        confidence: 'high',
        title: 'Test finding',
        description: 'A test finding for replay.',
        location: { path: 'src/test.ts', startLine: 10 },
      },
    ],
    durationMs: 2500,
    ...overrides,
  };
}

/** Build a minimal JSONL summary record. */
function summaryRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run: {
      timestamp: '2026-02-08T14:30:45.123Z',
      durationMs: 5000,
      cwd: '/tmp/test',
      runId: randomUUID(),
    },
    type: 'summary',
    totalFindings: 1,
    bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    ...overrides,
  };
}

describe('runReplay', () => {
  let tmpDir: string;
  const originalStdoutWrite = process.stdout.write;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `warden-replay-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    console.log = vi.fn();
    console.error = vi.fn();
    process.stdout.write = vi.fn() as typeof process.stdout.write;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
  });

  it('returns error when no files specified', async () => {
    const reporter = makeReporter();
    const options = defaultOptions({ targets: undefined });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(1);
  });

  it('returns error when empty files array', async () => {
    const reporter = makeReporter();
    const options = defaultOptions({ targets: [] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(1);
  });

  it('returns error when file does not exist', async () => {
    const reporter = makeReporter();
    const options = defaultOptions({ targets: ['/nonexistent/file.jsonl'] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(1);
  });

  it('replays a single JSONL file with findings', async () => {
    const logPath = join(tmpDir, 'run.jsonl');
    const lines = [
      JSON.stringify(skillRecord()),
      JSON.stringify(summaryRecord()),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);

    // Verify the terminal report was printed
    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n');
    expect(logCalls).toContain('test-skill');
    expect(logCalls).toContain('Test finding');
  });

  it('replays multiple JSONL files', async () => {
    const log1 = join(tmpDir, 'run1.jsonl');
    const log2 = join(tmpDir, 'run2.jsonl');

    writeFileSync(log1, JSON.stringify(skillRecord({ skill: 'skill-one' })) + '\n' + JSON.stringify(summaryRecord()) + '\n');
    writeFileSync(log2, JSON.stringify(skillRecord({ skill: 'skill-two' })) + '\n' + JSON.stringify(summaryRecord()) + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [log1, log2] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n');
    expect(logCalls).toContain('skill-one');
    expect(logCalls).toContain('skill-two');
  });

  it('handles JSONL file with no skill records', async () => {
    const logPath = join(tmpDir, 'empty.jsonl');
    writeFileSync(logPath, JSON.stringify(summaryRecord({ totalFindings: 0 })) + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);
  });

  it('outputs raw JSONL with --json flag', async () => {
    const logPath = join(tmpDir, 'run.jsonl');
    const content = JSON.stringify(skillRecord()) + '\n' + JSON.stringify(summaryRecord()) + '\n';
    writeFileSync(logPath, content);

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath], json: true });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);

    // Verify raw JSONL was written to stdout
    const writes = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls.flat().join('');
    expect(writes).toContain('"skill":"test-skill"');
  });

  it('applies --report-on severity filtering', async () => {
    const logPath = join(tmpDir, 'run.jsonl');
    const record = skillRecord({
      findings: [
        {
          id: 'HIGH-001',
          severity: 'high',
          confidence: 'high',
          title: 'High severity finding',
          description: 'Important.',
          location: { path: 'src/test.ts', startLine: 10 },
        },
        {
          id: 'LOW-001',
          severity: 'low',
          confidence: 'high',
          title: 'Low severity finding',
          description: 'Minor.',
          location: { path: 'src/test.ts', startLine: 20 },
        },
      ],
    });
    writeFileSync(logPath, JSON.stringify(record) + '\n' + JSON.stringify(summaryRecord()) + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath], reportOn: 'high' });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n');
    expect(logCalls).toContain('High severity finding');
    expect(logCalls).not.toContain('Low severity finding');
  });

  it('skips fix-evaluation records', async () => {
    const logPath = join(tmpDir, 'run.jsonl');
    const fixEval = {
      run: {
        timestamp: '2026-02-08T14:30:53.500Z',
        durationMs: 8400,
        cwd: '/tmp/test',
        runId: randomUUID(),
      },
      type: 'fix-evaluation',
      evaluated: 1,
      resolved: 1,
      needsAttention: 0,
      skipped: 0,
      failedEvaluations: 0,
      evaluations: [],
    };
    const lines = [
      JSON.stringify(skillRecord()),
      JSON.stringify(summaryRecord()),
      JSON.stringify(fixEval),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);
  });

  it('returns error for malformed JSONL', async () => {
    const logPath = join(tmpDir, 'bad.jsonl');
    writeFileSync(logPath, 'not valid json\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(1);
  });

  it('preserves skill metadata through replay', async () => {
    const logPath = join(tmpDir, 'run.jsonl');
    const record = skillRecord({
      metadata: { customKey: 'customValue' },
      usage: { inputTokens: 1000, outputTokens: 200, costUSD: 0.01 },
      skippedFiles: [{ filename: 'dist/bundle.js', reason: 'builtin' }],
      failedHunks: 2,
      failedExtractions: 1,
    });
    writeFileSync(logPath, JSON.stringify(record) + '\n' + JSON.stringify(summaryRecord()) + '\n');

    const reporter = makeReporter();
    const options = defaultOptions({ targets: [logPath] });
    const exitCode = await runReplay(options, reporter);
    expect(exitCode).toBe(0);
  });
});
