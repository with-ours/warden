import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Finding } from '../types/index.js';
import {
  buildLinterCheckPrompt,
  proposalsToFindings,
  detectLinterConfig,
  evaluateLinterRules,
  type RuleProposal,
  type LinterConfig,
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

const mockConfig: LinterConfig = {
  path: '/repo/eslint.config.js',
  contents: `import eslint from "@eslint/js";
export default [
  eslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "error",
    },
  },
];
`,
};

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

    const prompt = buildLinterCheckPrompt(findings, mockConfig);

    expect(prompt).toContain('K7M-X9P');
    expect(prompt).toContain('Missing await on async call');
    expect(prompt).toContain('await doSomething()');
  });

  it('includes the config file contents', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })], mockConfig);

    expect(prompt).toContain('eslint.config.js');
    expect(prompt).toContain('no-unused-vars');
  });

  it('instructs for custom domain-specific rules, not generic ones', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })], mockConfig);

    expect(prompt).toContain('deterministic');
    expect(prompt).toContain('Do NOT suggest well-known generic rules');
    expect(prompt).toContain('AST');
  });

  it('requests unified diff format', () => {
    const prompt = buildLinterCheckPrompt([makeFinding({ id: 'X' })], mockConfig);

    expect(prompt).toContain('unified diff');
    expect(prompt).toContain('configDiff');
  });
});

describe('proposalsToFindings', () => {
  const originalFindings = [
    makeFinding({ id: 'A', title: 'eval() usage' }),
    makeFinding({ id: 'B', title: 'Command injection' }),
    makeFinding({ id: 'C', title: 'Weak random' }),
  ];

  it('converts proposals to findings with config diffs', () => {
    const proposals: RuleProposal[] = [
      {
        rule: 'no-eval',
        description: 'Bans eval() calls',
        findingIds: ['A'],
        configDiff: '@@ -5,1 +5,2 @@\n rules: {\n+  "no-eval": "error",',
      },
    ];

    const findings = proposalsToFindings(proposals, '/repo/eslint.config.js', originalFindings);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toBe('Prevention: enable no-eval');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.location!.path).toBe('/repo/eslint.config.js');
    expect(findings[0]!.suggestedFix!.diff).toContain('no-eval');
    expect(findings[0]!.description).toContain('eval() usage');
  });

  it('groups multiple finding IDs under one rule', () => {
    const proposals: RuleProposal[] = [
      {
        rule: 'security/detect-child-process',
        description: 'Detects shell injection',
        findingIds: ['A', 'B'],
        configDiff: '@@ -1,1 +1,2 @@\n+// rule added',
      },
    ];

    const findings = proposalsToFindings(proposals, '/repo/config.js', originalFindings);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.description).toContain('eval() usage');
    expect(findings[0]!.description).toContain('Command injection');
  });

  it('filters out proposals without a diff', () => {
    const proposals: RuleProposal[] = [
      { rule: 'no-eval', description: 'Bans eval', findingIds: ['A'], configDiff: '' },
    ];

    const findings = proposalsToFindings(proposals, '/repo/config.js', originalFindings);
    expect(findings).toHaveLength(0);
  });

  it('filters out proposals with no finding IDs', () => {
    const proposals: RuleProposal[] = [
      { rule: 'no-eval', description: 'Bans eval', findingIds: [], configDiff: 'some diff' },
    ];

    const findings = proposalsToFindings(proposals, '/repo/config.js', originalFindings);
    expect(findings).toHaveLength(0);
  });

  it('generates unique IDs for each finding', () => {
    const proposals: RuleProposal[] = [
      { rule: 'no-eval', description: 'a', findingIds: ['A'], configDiff: 'diff1' },
      { rule: 'eqeqeq', description: 'b', findingIds: ['B'], configDiff: 'diff2' },
    ];

    const findings = proposalsToFindings(proposals, '/repo/config.js', originalFindings);
    expect(findings[0]!.id).not.toBe(findings[1]!.id);
  });
});

describe('evaluateLinterRules', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('parses valid response into prevention findings', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `
  "rules": [
    {
      "rule": "no-eval",
      "description": "Bans eval() calls which enable arbitrary code execution",
      "findingIds": ["A1B-C2D"],
      "configDiff": "@@ -5,1 +5,2 @@\\n rules: {\\n+  \\"no-eval\\": \\"error\\","
    }
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

    const findings = [makeFinding({ id: 'A1B-C2D', title: 'eval() usage' })];
    const result = await evaluateLinterRules(findings, mockConfig, 'test-key');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.title).toContain('no-eval');
    expect(result.findings[0]!.suggestedFix!.diff).toContain('no-eval');
    expect(result.usage.inputTokens).toBe(500);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty findings for malformed JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json at all' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await evaluateLinterRules([makeFinding({ id: 'X' })], mockConfig, 'test-key');

    expect(result.findings).toHaveLength(0);
  });

  it('returns empty findings when no rules proposed', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await evaluateLinterRules([makeFinding({ id: 'X' })], mockConfig, 'test-key');

    expect(result.findings).toHaveLength(0);
  });

  it('sends prefill with opening brace and uses haiku', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await evaluateLinterRules([makeFinding({ id: 'X' })], mockConfig, 'test-key');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[1]).toEqual({ role: 'assistant', content: '{' });
    expect(callArgs.model).toBe('claude-haiku-4-5');
  });

  it('includes config contents in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '"rules": []}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await evaluateLinterRules([makeFinding({ id: 'X' })], mockConfig, 'test-key');

    const callArgs = mockCreate.mock.calls[0]![0];
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('no-unused-vars');
    expect(userMessage).toContain('eslint.config.js');
  });
});
