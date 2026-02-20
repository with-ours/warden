import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runReplay } from './replay.js';
import { Reporter } from '../output/reporter.js';
import { detectOutputMode } from '../output/tty.js';
import { Verbosity } from '../output/verbosity.js';
import type { CLIOptions } from '../args.js';

function createMockReporter(): Reporter {
  return new Reporter(detectOutputMode(false), Verbosity.Normal);
}

function createOptions(overrides: Partial<CLIOptions> = {}): CLIOptions {
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

const SAMPLE_JSONL = `{"run":{"timestamp":"2026-02-08T14:30:45.123Z","durationMs":5200,"cwd":"/home/user/myrepo","runId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"},"skill":"security-review","summary":"security-review: Found 2 issues (1 high, 1 medium)","findings":[{"id":"SEC-001","severity":"high","confidence":"high","title":"SQL injection risk in query builder","description":"User input is interpolated directly into a SQL query string without parameterization.","location":{"path":"src/api/auth.ts","startLine":42,"endLine":45}},{"id":"SEC-002","severity":"medium","confidence":"medium","title":"Unsafe type assertion on external input","description":"External API response is cast to an internal type without validation.","location":{"path":"src/utils/helpers.ts","startLine":15}}],"durationMs":3500,"usage":{"inputTokens":5000,"outputTokens":800,"cacheReadInputTokens":1200,"costUSD":0.01}}
{"run":{"timestamp":"2026-02-08T14:30:45.123Z","durationMs":5200,"cwd":"/home/user/myrepo","runId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"},"type":"summary","totalFindings":2,"bySeverity":{"critical":0,"high":1,"medium":1,"low":0,"info":0},"usage":{"inputTokens":5000,"outputTokens":800,"cacheReadInputTokens":1200,"costUSD":0.01}}
`;

describe('replay command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-replay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('basic replay', () => {
    it('replays a single JSONL log file', async () => {
      const logFile = join(tempDir, 'test.jsonl');
      writeFileSync(logFile, SAMPLE_JSONL);

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile] }), reporter);

      expect(exitCode).toBe(0);
    });

    it('replays multiple JSONL log files', async () => {
      const logFile1 = join(tempDir, 'test1.jsonl');
      const logFile2 = join(tempDir, 'test2.jsonl');
      writeFileSync(logFile1, SAMPLE_JSONL);
      writeFileSync(logFile2, SAMPLE_JSONL);

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile1, logFile2] }), reporter);

      expect(exitCode).toBe(0);
    });

    it('handles glob patterns', async () => {
      mkdirSync(join(tempDir, '.warden', 'logs'), { recursive: true });
      const logFile1 = join(tempDir, '.warden', 'logs', '2026-02-08-run1.jsonl');
      const logFile2 = join(tempDir, '.warden', 'logs', '2026-02-08-run2.jsonl');
      writeFileSync(logFile1, SAMPLE_JSONL);
      writeFileSync(logFile2, SAMPLE_JSONL);

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: ['.warden/logs/*.jsonl'] }), reporter);

      expect(exitCode).toBe(0);
    });
  });

  describe('JSON output', () => {
    it('outputs JSONL when --json is specified', async () => {
      const logFile = join(tempDir, 'test.jsonl');
      writeFileSync(logFile, SAMPLE_JSONL);

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const reporter = createMockReporter();

      const exitCode = await runReplay(createOptions({ targets: [logFile], json: true }), reporter);

      expect(exitCode).toBe(0);
      expect(stdoutWrite).toHaveBeenCalled();

      // Check that the output contains JSONL content
      const output = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"skill":"security-review"');
      expect(output).toContain('"type":"summary"');

      stdoutWrite.mockRestore();
    });
  });

  describe('filtering', () => {
    it('respects --report-on filter', async () => {
      const logFile = join(tempDir, 'test.jsonl');
      writeFileSync(logFile, SAMPLE_JSONL);

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile], reportOn: 'high' }), reporter);

      expect(exitCode).toBe(0);
    });

    it('respects --min-confidence filter', async () => {
      const logFile = join(tempDir, 'test.jsonl');
      writeFileSync(logFile, SAMPLE_JSONL);

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile], minConfidence: 'high' }), reporter);

      expect(exitCode).toBe(0);
    });
  });

  describe('error handling', () => {
    it('fails when no log files are specified', async () => {
      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: undefined }), reporter);

      expect(exitCode).toBe(1);
    });

    it('fails when log file does not exist', async () => {
      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: ['nonexistent.jsonl'] }), reporter);

      expect(exitCode).toBe(1);
    });

    it('handles empty log files gracefully', async () => {
      const logFile = join(tempDir, 'empty.jsonl');
      writeFileSync(logFile, '');

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile] }), reporter);

      expect(exitCode).toBe(0);
    });

    it('handles log files with only summary record', async () => {
      const logFile = join(tempDir, 'summary-only.jsonl');
      writeFileSync(logFile, '{"run":{"timestamp":"2026-02-08T14:30:45.123Z","durationMs":0,"cwd":"/home/user/myrepo","runId":"test"},"type":"summary","totalFindings":0,"bySeverity":{}}\n');

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile] }), reporter);

      expect(exitCode).toBe(0);
    });

    it('handles invalid JSONL gracefully', async () => {
      const logFile = join(tempDir, 'invalid.jsonl');
      writeFileSync(logFile, 'not valid json\n');

      const reporter = createMockReporter();
      const exitCode = await runReplay(createOptions({ targets: [logFile] }), reporter);

      expect(exitCode).toBe(1);
    });
  });
});
