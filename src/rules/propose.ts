import { z } from 'zod';
import type { UsageStats } from '../types/index.js';
import { callSonnet } from '../sdk/sonnet.js';
import { aggregateUsage, emptyUsage } from '../sdk/usage.js';
import { CUSTOM_RULE_TEMPLATE } from './linters/flake8.js';
import type { FindingCluster, RuleProposal } from './types.js';

/**
 * Draft proposal schema from Sonnet.
 */
const DraftProposalSchema = z.object({
  type: z.enum(['custom-rule', 'no-viable-rule']),
  rationale: z.string(),
  uncertainties: z.array(z.string()),
  customRuleCode: z.string().optional(),
});

/**
 * Adversarial check result schema.
 */
const AdversarialSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  issues: z.array(z.string()),
});

/**
 * Stage 2a: Draft a rule proposal using Sonnet.
 */
async function draftProposal(
  cluster: FindingCluster,
  linter: string,
  apiKey: string,
): Promise<{ draft: z.infer<typeof DraftProposalSchema>; usage: UsageStats }> {
  const examples = cluster.codeExamples.length > 0
    ? `\n\nCode examples from findings:\n${cluster.codeExamples.map((e) => '```python\n' + e + '\n```').join('\n')}`
    : '';

  const prompt = `You are writing a custom flake8 AST checker to catch a recurring code review finding pattern.

## Finding Pattern
Pattern: "${cluster.pattern}"
Severity: ${cluster.severity}
Occurred ${cluster.runCount} times

Titles:
${cluster.titles.slice(0, 5).map((t) => `- ${t}`).join('\n')}

Descriptions:
${cluster.descriptions.map((d) => `- ${d.slice(0, 300)}`).join('\n')}

File paths: ${cluster.paths.slice(0, 10).join(', ')}${examples}

## Custom Rule Template

Your checker MUST follow this structure exactly:

\`\`\`python
${CUSTOM_RULE_TEMPLATE}
\`\`\`

The checker class MUST:
- Be named \`CustomChecker\`
- Have \`name\` and \`version\` class attributes
- Accept \`tree: ast.AST\` in \`__init__\`
- Have a \`run()\` method yielding \`(line, col, message, type)\` tuples
- Use error codes starting with \`X0\` (e.g., X001, X002)
- Be precise: catch the SPECIFIC pattern described, not a broad category

## Instructions

Write a custom ${linter} AST checker that catches this specific pattern. Choose one:

1. "custom-rule": You can write a checker that catches this pattern. Provide the full Python code.
2. "no-viable-rule": This pattern cannot be reliably caught by AST analysis. Explain why.

Do NOT propose enabling an existing rule. Existing rules are too broad for repo-specific patterns.
Write a targeted checker that catches exactly this pattern with minimal false positives.

Be conservative. If you're unsure whether an AST checker can reliably detect this, say "no-viable-rule".

Respond with JSON:
{
  "type": "custom-rule" | "no-viable-rule",
  "rationale": "why this checker works / why no rule is viable",
  "uncertainties": ["what might go wrong"],
  "customRuleCode": "full python code for custom-rule type"
}`;

  const result = await callSonnet({
    apiKey,
    prompt,
    schema: DraftProposalSchema,
  });

  if (!result.success) {
    return {
      draft: {
        type: 'no-viable-rule',
        rationale: `Proposal generation failed: ${result.error}`,
        uncertainties: [],
      },
      usage: result.usage,
    };
  }

  return { draft: result.data, usage: result.usage };
}

/**
 * Stage 2b: Adversarial check using a second Sonnet call.
 */
async function adversarialCheck(
  cluster: FindingCluster,
  draft: z.infer<typeof DraftProposalSchema>,
  apiKey: string,
): Promise<{ verdict: 'pass' | 'fail'; issues: string[]; usage: UsageStats }> {
  const examples = cluster.codeExamples.length > 0
    ? `\n\nCode examples:\n${cluster.codeExamples.map((e) => '```python\n' + e + '\n```').join('\n')}`
    : '';

  const prompt = `You are reviewing a custom flake8 AST checker to determine if it actually catches the described pattern. Your job is to find flaws.

## Finding Pattern
Pattern: "${cluster.pattern}"
Titles: ${cluster.titles.slice(0, 3).join(', ')}
Descriptions:
${cluster.descriptions.map((d) => `- ${d.slice(0, 200)}`).join('\n')}${examples}

## Proposed Custom Checker
Rationale: ${draft.rationale}

\`\`\`python
${draft.customRuleCode ?? '# No code provided'}
\`\`\`

## Your Task

Challenge this checker aggressively:

1. Does the Python code parse and follow the flake8 checker API correctly? (CustomChecker class, run() method, yields tuples)
2. Does the AST analysis actually detect the described pattern? Walk through the logic step by step.
3. Would it fire on code that exhibits this pattern? Be specific about what AST nodes it matches.
4. What are plausible false positive scenarios? Would it flag correct code?
5. Is it too broad (fires on unrelated code) or too narrow (misses the pattern)?

Respond with JSON:
{
  "verdict": "pass" | "fail",
  "issues": ["list of issues found, even for pass verdict"]
}

Rules:
- "fail" if the code has syntax errors or doesn't follow flake8 checker API
- "fail" if the AST logic doesn't actually match the described pattern
- "fail" if the false positive rate would be unacceptable
- "pass" if the checker reasonably catches the pattern despite minor concerns`;

  const result = await callSonnet({
    apiKey,
    prompt,
    schema: AdversarialSchema,
  });

  if (!result.success) {
    // On failure, be conservative: fail the check
    return { verdict: 'fail', issues: [`Adversarial check failed: ${result.error}`], usage: result.usage };
  }

  return { verdict: result.data.verdict, issues: result.data.issues, usage: result.usage };
}

/**
 * Pass 2: Propose rules for lint-catchable clusters.
 *
 * For each cluster:
 * 1. Draft a proposal using Sonnet
 * 2. Run adversarial check with a second Sonnet call
 * 3. Only keep proposals that pass both stages
 */
export async function propose(
  clusters: FindingCluster[],
  linter: string,
  apiKey: string,
  onProgress?: (message: string) => void,
): Promise<{ proposals: RuleProposal[]; usage: UsageStats }> {
  const lintCatchable = clusters.filter((c) => c.classification === 'lint-catchable');

  if (lintCatchable.length === 0) {
    onProgress?.('No lint-catchable clusters to propose rules for');
    return { proposals: [], usage: emptyUsage() };
  }

  onProgress?.(`Proposing rules for ${lintCatchable.length} patterns...`);

  const usages: UsageStats[] = [];
  const proposals: RuleProposal[] = [];

  for (const cluster of lintCatchable) {
    // Stage 2a: Draft
    onProgress?.(`  Drafting rule for: ${cluster.titles[0]?.slice(0, 60) ?? cluster.pattern}`);
    const { draft, usage: draftUsage } = await draftProposal(cluster, linter, apiKey);
    usages.push(draftUsage);

    // Skip no-viable-rule proposals
    if (draft.type === 'no-viable-rule') {
      proposals.push({
        clusterId: cluster.id,
        linter,
        type: 'no-viable-rule',
        rationale: draft.rationale,
        uncertainties: draft.uncertainties,
        adversarialVerdict: 'pass',
        adversarialIssues: [],
      });
      continue;
    }

    // Stage 2b: Adversarial check
    onProgress?.(`  Challenging custom checker...`);
    const { verdict, issues, usage: advUsage } = await adversarialCheck(cluster, draft, apiKey);
    usages.push(advUsage);

    proposals.push({
      clusterId: cluster.id,
      linter,
      type: 'custom-rule',
      rationale: draft.rationale,
      uncertainties: draft.uncertainties,
      customRuleCode: draft.customRuleCode,
      adversarialVerdict: verdict,
      adversarialIssues: issues,
    });

    if (verdict === 'fail') {
      onProgress?.(`  Rejected: ${issues[0] ?? 'adversarial check failed'}`);
    } else {
      onProgress?.(`  Passed adversarial check`);
    }
  }

  const passed = proposals.filter((p) => p.adversarialVerdict === 'pass' && p.type !== 'no-viable-rule');
  onProgress?.(`Proposed ${passed.length} rules (${proposals.length - passed.length} rejected or no-viable-rule)`);

  return {
    proposals,
    usage: usages.length > 0 ? aggregateUsage(usages) : emptyUsage(),
  };
}
