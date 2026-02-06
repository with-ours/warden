import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Finding } from '../types/index.js';
import {
  buildLinterCheckPrompt,
  groupByRule,
  evaluateLinterRules,
  renderLinterCheck,
  type LinterVerdict,
  type LinterCheckResult,
} from './linter-check.js';
import { Reporter } from './output/reporter.js';
import { Verbosity } from './output/verbosity.js';
import type { OutputMode } from './output/tty.js';

// Mock Anthropic SDK as a class constructor
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

function makeFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    severity: 'medium',
    title: 'Test finding',
    description: 'Test description',
    location: { path: 'src/test.ts', startLine: 10 },
    suggestedFix: {
      description: 'Add await',
      diff: '@@ -10,1 +10,1 @@\n-doSomething();\n+await doSomething();',
    },
    ...overrides,
  };
}

describe('buildLinterCheckPrompt', () => {
  it('includes finding id, title, and diff', () => {
    const findings = [
      makeFinding({ id: 'K7M-X9P', title: 'Missing await on async call' }),
    ];

    const prompt = buildLinterCheckPrompt(findings);

    expect(prompt).toContain('K7M-X9P');
    expect(prompt).toContain('Missing await on async call');
    expect(prompt).toContain('await doSomething()');
  });

  it('includes file path and line number', () => {
    const findings = [
      makeFinding({
        id: 'ABC-123',
        location: { path: 'src/api/handler.ts', startLine: 42 },
      }),
    ];

    const prompt = buildLinterCheckPrompt(findings);

    expect(prompt).toContain('src/api/handler.ts:42');
  });

  it('handles findings without location', () => {
    const findings = [
      makeFinding({
        id: 'DEF-456',
        location: undefined,
      }),
    ];

    const prompt = buildLinterCheckPrompt(findings);

    expect(prompt).toContain('DEF-456');
    expect(prompt).not.toContain('file:');
  });

  it('handles findings without diff', () => {
    const findings = [
      makeFinding({
        id: 'GHI-789',
        suggestedFix: undefined,
      }),
    ];

    const prompt = buildLinterCheckPrompt(findings);

    expect(prompt).toContain('GHI-789');
    expect(prompt).not.toContain('diff:');
  });

  it('instructs for deterministic rules only', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })]);

    expect(prompt).toContain('deterministic');
    expect(prompt).toContain('not heuristic');
    expect(prompt).toContain('not AI-based');
  });

  it('includes multiple findings', () => {
    const findings = [
      makeFinding({ id: 'A1B-C2D' }),
      makeFinding({ id: 'E3F-G4H' }),
    ];

    const prompt = buildLinterCheckPrompt(findings);

    expect(prompt).toContain('A1B-C2D');
    expect(prompt).toContain('E3F-G4H');
  });
});

describe('groupByRule', () => {
  const findings = [
    makeFinding({ id: 'A', title: 'Finding A' }),
    makeFinding({ id: 'B', title: 'Finding B' }),
    makeFinding({ id: 'C', title: 'Finding C' }),
    makeFinding({ id: 'D', title: 'Finding D' }),
  ];

  it('groups verdicts by linter::rule', () => {
    const verdicts: LinterVerdict[] = [
      { findingId: 'A', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: 'needs await' },
      { findingId: 'B', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: 'needs await' },
      { findingId: 'C', detectable: true, linter: 'eslint', rule: 'eqeqeq', reasoning: 'strict equality' },
    ];

    const groups = groupByRule(verdicts, findings);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.linter).toBe('eslint');
    expect(groups[0]!.rule).toBe('no-floating-promises');
    expect(groups[0]!.findings).toHaveLength(2);
    expect(groups[1]!.rule).toBe('eqeqeq');
    expect(groups[1]!.findings).toHaveLength(1);
  });

  it('sorts groups by finding count descending', () => {
    const verdicts: LinterVerdict[] = [
      { findingId: 'A', detectable: true, linter: 'eslint', rule: 'eqeqeq', reasoning: '' },
      { findingId: 'B', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: '' },
      { findingId: 'C', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: '' },
      { findingId: 'D', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: '' },
    ];

    const groups = groupByRule(verdicts, findings);

    expect(groups[0]!.rule).toBe('no-floating-promises');
    expect(groups[0]!.findings).toHaveLength(3);
    expect(groups[1]!.rule).toBe('eqeqeq');
    expect(groups[1]!.findings).toHaveLength(1);
  });

  it('excludes non-detectable verdicts', () => {
    const verdicts: LinterVerdict[] = [
      { findingId: 'A', detectable: false, linter: null, rule: null, reasoning: 'too complex' },
      { findingId: 'B', detectable: true, linter: 'eslint', rule: 'eqeqeq', reasoning: '' },
    ];

    const groups = groupByRule(verdicts, findings);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.findings).toHaveLength(1);
  });

  it('returns empty array when no detectable verdicts', () => {
    const verdicts: LinterVerdict[] = [
      { findingId: 'A', detectable: false, linter: null, rule: null, reasoning: 'nope' },
    ];

    const groups = groupByRule(verdicts, findings);
    expect(groups).toHaveLength(0);
  });

  it('ignores verdicts for unknown finding IDs', () => {
    const verdicts: LinterVerdict[] = [
      { findingId: 'UNKNOWN', detectable: true, linter: 'eslint', rule: 'eqeqeq', reasoning: '' },
    ];

    const groups = groupByRule(verdicts, findings);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.findings).toHaveLength(0);
  });
});

describe('evaluateLinterRules', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('parses valid JSON response and returns verdicts', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `
  "verdicts": [
    {"findingId": "A1B-C2D", "detectable": true, "linter": "eslint", "rule": "no-floating-promises", "reasoning": "missing await"}
  ]
}`,
        },
      ],
      usage: {
        input_tokens: 500,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });

    const findings = [makeFinding({ id: 'A1B-C2D' })];
    const result = await evaluateLinterRules(findings, 'test-key');

    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0]!.findingId).toBe('A1B-C2D');
    expect(result.verdicts[0]!.detectable).toBe(true);
    expect(result.verdicts[0]!.linter).toBe('eslint');
    expect(result.verdicts[0]!.rule).toBe('no-floating-promises');
    expect(result.grouped).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(500);
    expect(result.usage.outputTokens).toBe(100);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty verdicts for malformed JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json at all' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const findings = [makeFinding({ id: 'X' })];
    const result = await evaluateLinterRules(findings, 'test-key');

    expect(result.verdicts).toHaveLength(0);
    expect(result.grouped).toHaveLength(0);
  });

  it('returns empty verdicts when response has no text content', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
    });

    const findings = [makeFinding({ id: 'X' })];
    const result = await evaluateLinterRules(findings, 'test-key');

    expect(result.verdicts).toHaveLength(0);
  });

  it('tracks usage stats from API response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"verdicts": []}' }],
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 100,
      },
    });

    const findings = [makeFinding({ id: 'X' })];
    const result = await evaluateLinterRules(findings, 'test-key');

    expect(result.usage.inputTokens).toBe(1200);
    expect(result.usage.outputTokens).toBe(300);
    expect(result.usage.cacheReadInputTokens).toBe(400);
    expect(result.usage.cacheCreationInputTokens).toBe(100);
    expect(result.usage.costUSD).toBeGreaterThan(0);
  });

  it('sends prefill with opening brace', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"verdicts": []}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const findings = [makeFinding({ id: 'X' })];
    await evaluateLinterRules(findings, 'test-key');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[1]).toEqual({ role: 'assistant', content: '{' });
    expect(callArgs.model).toBe('claude-haiku-4-5');
  });
});

describe('renderLinterCheck', () => {
  function makeResult(overrides: Partial<LinterCheckResult> = {}): LinterCheckResult {
    return {
      verdicts: [
        { findingId: 'A', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: '' },
        { findingId: 'B', detectable: true, linter: 'eslint', rule: 'no-floating-promises', reasoning: '' },
        { findingId: 'C', detectable: true, linter: 'eslint', rule: 'eqeqeq', reasoning: '' },
        { findingId: 'D', detectable: false, linter: null, rule: null, reasoning: '' },
      ],
      grouped: [
        {
          linter: 'eslint',
          rule: 'no-floating-promises',
          findings: [
            makeFinding({ id: 'A', title: 'Missing await' }),
            makeFinding({ id: 'B', title: 'Unhandled promise' }),
          ],
        },
        {
          linter: 'eslint',
          rule: 'eqeqeq',
          findings: [
            makeFinding({ id: 'C', title: 'Loose equality' }),
          ],
        },
      ],
      usage: { inputTokens: 500, outputTokens: 100, costUSD: 0.05 },
      durationMs: 1200,
      ...overrides,
    };
  }

  it('renders nothing when no detectable verdicts', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mode: OutputMode = { isTTY: true, supportsColor: false, columns: 80 };
    const reporter = new Reporter(mode, Verbosity.Normal);

    const result = makeResult({
      verdicts: [{ findingId: 'A', detectable: false, linter: null, rule: null, reasoning: '' }],
      grouped: [],
    });

    renderLinterCheck(result, reporter);

    // Should not output PREVENTION header
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('PREVENTION'))).toBe(false);

    stderrSpy.mockRestore();
  });

  it('renders TTY output with rule names and counts', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mode: OutputMode = { isTTY: true, supportsColor: false, columns: 80 };
    const reporter = new Reporter(mode, Verbosity.Normal);

    renderLinterCheck(makeResult(), reporter);

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('PREVENTION');
    expect(output).toContain('3 of 4');
    expect(output).toContain('no-floating-promises');
    expect(output).toContain('eqeqeq');
    expect(output).toContain('2 findings');
    expect(output).toContain('1 finding');
    expect(output).toContain('Missing await');
    expect(output).toContain('Loose equality');
    expect(output).toContain('1.2s');

    stderrSpy.mockRestore();
  });

  it('renders non-TTY output with rule names and counts', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mode: OutputMode = { isTTY: false, supportsColor: false, columns: 80 };
    const reporter = new Reporter(mode, Verbosity.Normal);

    renderLinterCheck(makeResult(), reporter);

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('PREVENTION');
    expect(output).toContain('no-floating-promises');
    expect(output).toContain('eqeqeq');
    expect(output).toContain('3 of 4');

    stderrSpy.mockRestore();
  });

  it('includes cost in output', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mode: OutputMode = { isTTY: true, supportsColor: false, columns: 80 };
    const reporter = new Reporter(mode, Verbosity.Normal);

    renderLinterCheck(makeResult(), reporter);

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('$0.05');

    stderrSpy.mockRestore();
  });
});
