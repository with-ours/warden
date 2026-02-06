import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Finding } from '../types/index.js';
import {
  buildLinterCheckPrompt,
  proposalsToFindings,
  implementationToDiff,
  detectLinterConfig,
  evaluateLinterRules,
  type RuleProposal,
} from './linter-check.js';

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

const SAMPLE_IMPLEMENTATION = `module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Ban eval() calls" },
    messages: { found: "Do not use eval()" },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.name === "eval") {
          context.report({ node, messageId: "found" });
        }
      },
    };
  },
};`;

describe('detectLinterConfig', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `warden-linter-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('finds eslint.config.js', () => {
    writeFileSync(join(testDir, 'eslint.config.js'), 'export default [];');

    const result = detectLinterConfig(testDir);

    expect(result).not.toBeNull();
    expect(result!.path).toContain('eslint.config.js');
    expect(result!.contents).toBe('export default [];');
  });

  it('finds .eslintrc.json', () => {
    writeFileSync(join(testDir, '.eslintrc.json'), '{"rules": {}}');

    const result = detectLinterConfig(testDir);

    expect(result).not.toBeNull();
    expect(result!.path).toContain('.eslintrc.json');
  });

  it('finds biome.json', () => {
    writeFileSync(join(testDir, 'biome.json'), '{}');

    const result = detectLinterConfig(testDir);

    expect(result).not.toBeNull();
    expect(result!.path).toContain('biome.json');
  });

  it('prefers eslint.config.js over legacy .eslintrc.json', () => {
    writeFileSync(join(testDir, 'eslint.config.js'), 'flat config');
    writeFileSync(join(testDir, '.eslintrc.json'), 'legacy config');

    const result = detectLinterConfig(testDir);

    expect(result!.path).toContain('eslint.config.js');
    expect(result!.contents).toBe('flat config');
  });

  it('returns null when no config found', () => {
    const result = detectLinterConfig(testDir);
    expect(result).toBeNull();
  });
});

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

  it('instructs for custom domain-specific rules, not generic ones', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })]);

    expect(prompt).toContain('deterministic');
    expect(prompt).toContain('Do NOT suggest well-known generic rules');
    expect(prompt).toContain('AST');
  });

  it('requests implementation with meta and create', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })]);

    expect(prompt).toContain('implementation');
    expect(prompt).toContain('rulePath');
    expect(prompt).toContain('meta');
    expect(prompt).toContain('create');
  });
});

describe('implementationToDiff', () => {
  it('generates a new-file unified diff', () => {
    const diff = implementationToDiff('eslint-rules/no-eval.js', 'line1\nline2\nline3');

    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/eslint-rules/no-eval.js');
    expect(diff).toContain('@@ -0,0 +1,3 @@');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
    expect(diff).toContain('+line3');
  });

  it('handles single-line implementation', () => {
    const diff = implementationToDiff('rules/x.js', 'module.exports = {};');

    expect(diff).toContain('@@ -0,0 +1,1 @@');
    expect(diff).toContain('+module.exports = {};');
  });
});

describe('proposalsToFindings', () => {
  const originalFindings = [
    makeFinding({ id: 'A', title: 'eval() usage' }),
    makeFinding({ id: 'B', title: 'Command injection' }),
    makeFinding({ id: 'C', title: 'Weak random' }),
  ];

  it('converts proposals to findings with rule implementations', () => {
    const proposals: RuleProposal[] = [
      {
        rule: 'ban-eval-calls',
        description: 'Bans eval() calls',
        findingIds: ['A'],
        rulePath: 'eslint-rules/ban-eval-calls.js',
        implementation: SAMPLE_IMPLEMENTATION,
      },
    ];

    const findings = proposalsToFindings(proposals, '/repo', originalFindings);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toBe('Prevention: ban-eval-calls');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.location!.path).toBe('/repo/eslint-rules/ban-eval-calls.js');
    expect(findings[0]!.suggestedFix!.diff).toContain('+module.exports');
    expect(findings[0]!.suggestedFix!.diff).toContain('--- /dev/null');
    expect(findings[0]!.suggestedFix!.description).toContain('ban-eval-calls');
    expect(findings[0]!.description).toContain('eval() usage');
  });

  it('groups multiple finding IDs under one rule', () => {
    const proposals: RuleProposal[] = [
      {
        rule: 'ban-child-process',
        description: 'Detects shell injection',
        findingIds: ['A', 'B'],
        rulePath: 'eslint-rules/ban-child-process.js',
        implementation: SAMPLE_IMPLEMENTATION,
      },
    ];

    const findings = proposalsToFindings(proposals, '/repo', originalFindings);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.description).toContain('eval() usage');
    expect(findings[0]!.description).toContain('Command injection');
  });

  it('filters out proposals without implementation', () => {
    const proposals: RuleProposal[] = [
      { rule: 'no-eval', description: 'Bans eval', findingIds: ['A'], rulePath: 'eslint-rules/x.js', implementation: '' },
    ];

    const findings = proposalsToFindings(proposals, '/repo', originalFindings);
    expect(findings).toHaveLength(0);
  });

  it('filters out proposals with no finding IDs', () => {
    const proposals: RuleProposal[] = [
      { rule: 'no-eval', description: 'Bans eval', findingIds: [], rulePath: 'eslint-rules/x.js', implementation: SAMPLE_IMPLEMENTATION },
    ];

    const findings = proposalsToFindings(proposals, '/repo', originalFindings);
    expect(findings).toHaveLength(0);
  });

  it('generates unique IDs for each finding', () => {
    const proposals: RuleProposal[] = [
      { rule: 'rule-a', description: 'a', findingIds: ['A'], rulePath: 'eslint-rules/a.js', implementation: SAMPLE_IMPLEMENTATION },
      { rule: 'rule-b', description: 'b', findingIds: ['B'], rulePath: 'eslint-rules/b.js', implementation: SAMPLE_IMPLEMENTATION },
    ];

    const findings = proposalsToFindings(proposals, '/repo', originalFindings);
    expect(findings[0]!.id).not.toBe(findings[1]!.id);
  });
});

describe('evaluateLinterRules', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('parses valid response into prevention findings', async () => {
    const impl = 'module.exports = { create() { return {}; } };';
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `
  "rules": [
    {
      "rule": "ban-eval-calls",
      "description": "Bans eval() calls which enable arbitrary code execution",
      "findingIds": ["A1B-C2D"],
      "rulePath": "eslint-rules/ban-eval-calls.js",
      "implementation": ${JSON.stringify(impl)}
    }
  ]
}`,
        },
      ],
      usage: {
        input_tokens: 500,
        output_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });

    const findings = [makeFinding({ id: 'A1B-C2D', title: 'eval() usage' })];
    const result = await evaluateLinterRules(findings, '/repo', 'test-key');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.title).toContain('ban-eval-calls');
    expect(result.findings[0]!.suggestedFix!.diff).toContain('+module.exports');
    expect(result.usage.inputTokens).toBe(500);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty findings for malformed JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json at all' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await evaluateLinterRules([makeFinding({ id: 'X' })], '/repo', 'test-key');

    expect(result.findings).toHaveLength(0);
  });

  it('returns empty findings when no rules proposed', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await evaluateLinterRules([makeFinding({ id: 'X' })], '/repo', 'test-key');

    expect(result.findings).toHaveLength(0);
  });

  it('sends prefill with opening brace and uses haiku', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await evaluateLinterRules([makeFinding({ id: 'X' })], '/repo', 'test-key');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[1]).toEqual({ role: 'assistant', content: '{' });
    expect(callArgs.model).toBe('claude-haiku-4-5');
  });

  it('includes finding details in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await evaluateLinterRules([makeFinding({ id: 'X', title: 'Test finding' })], '/repo', 'test-key');

    const callArgs = mockCreate.mock.calls[0]![0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('Test finding');
    expect(userMessage).toContain('implementation');
  });
});
