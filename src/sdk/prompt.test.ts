import { describe, it, expect } from 'vitest';
import { buildHunkUserPrompt, type PriorFindingsContext, type PRPromptContext } from './prompt.js';
import type { SkillDefinition } from '../config/schema.js';
import type { HunkWithContext } from '../diff/index.js';
import type { SkillReport } from '../types/index.js';

/** Minimal skill stub. */
const skill: SkillDefinition = {
  name: 'test-skill',
  description: 'Test skill',
  prompt: 'Check for issues',
};

/** Minimal hunk stub. */
function makeHunk(filename: string): HunkWithContext {
  return {
    filename,
    hunk: {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 5,
      content: '@@ -1,3 +1,5 @@\n line1\n+line2\n+line3\n line4\n line5',
      lines: [' line1', '+line2', '+line3', ' line4', ' line5'],
    },
    contextBefore: [],
    contextAfter: [],
    contextStartLine: 1,
    language: 'typescript',
  };
}

/** Minimal skill report stub. */
function makeReport(skillName: string, findings: SkillReport['findings']): SkillReport {
  return {
    skill: skillName,
    summary: `${skillName}: ${findings.length} findings`,
    findings,
  };
}

describe('buildHunkUserPrompt', () => {
  it('returns unchanged output when no prior findings provided', () => {
    const hunk = makeHunk('src/foo.ts');
    const result = buildHunkUserPrompt(skill, hunk);
    expect(result).not.toContain('Prior Findings');
    expect(result).toContain('test-skill');
  });

  it('includes Prior Findings section for matching file', () => {
    const hunk = makeHunk('src/foo.ts');
    const priorFindings: PriorFindingsContext = {
      reports: [
        makeReport('security-scan', [
          {
            id: 'sec-1',
            severity: 'high',
            title: 'SQL Injection',
            description: 'Unsanitized input in query',
            location: { path: 'src/foo.ts', startLine: 10 },
          },
        ]),
      ],
    };

    const result = buildHunkUserPrompt(skill, hunk, undefined, priorFindings);
    expect(result).toContain('## Prior Findings');
    expect(result).toContain('security-scan');
    expect(result).toContain('[high] SQL Injection');
    expect(result).toContain('Unsanitized input in query');
  });

  it('omits Prior Findings section when findings are for a different file', () => {
    const hunk = makeHunk('src/foo.ts');
    const priorFindings: PriorFindingsContext = {
      reports: [
        makeReport('security-scan', [
          {
            id: 'sec-1',
            severity: 'high',
            title: 'SQL Injection',
            description: 'Unsanitized input',
            location: { path: 'src/bar.ts', startLine: 10 },
          },
        ]),
      ],
    };

    const result = buildHunkUserPrompt(skill, hunk, undefined, priorFindings);
    expect(result).not.toContain('Prior Findings');
  });

  it('includes suggestedFix in serialized findings', () => {
    const hunk = makeHunk('src/foo.ts');
    const priorFindings: PriorFindingsContext = {
      reports: [
        makeReport('lint-check', [
          {
            id: 'lint-1',
            severity: 'medium',
            title: 'Unused variable',
            description: 'Variable x is declared but never used',
            location: { path: 'src/foo.ts', startLine: 5 },
            suggestedFix: {
              description: 'Remove the variable declaration',
              diff: '- const x = 1;',
            },
          },
        ]),
      ],
    };

    const result = buildHunkUserPrompt(skill, hunk, undefined, priorFindings);
    expect(result).toContain('Prior Findings');
    expect(result).toContain('Suggested fix: Remove the variable declaration');
  });

  it('places Prior Findings between PR context and diff', () => {
    const hunk = makeHunk('src/foo.ts');
    const prContext: PRPromptContext = {
      changedFiles: ['src/foo.ts', 'src/bar.ts'],
      title: 'Add feature',
    };
    const priorFindings: PriorFindingsContext = {
      reports: [
        makeReport('security-scan', [
          {
            id: 'sec-1',
            severity: 'high',
            title: 'Issue found',
            description: 'Details',
            location: { path: 'src/foo.ts', startLine: 1 },
          },
        ]),
      ],
    };

    const result = buildHunkUserPrompt(skill, hunk, prContext, priorFindings);

    const prContextIndex = result.indexOf('Pull Request Context');
    const priorFindingsIndex = result.indexOf('Prior Findings');
    const diffIndex = result.indexOf('## File:');

    // Prior findings should appear after PR context and before the diff
    expect(prContextIndex).toBeGreaterThan(-1);
    expect(priorFindingsIndex).toBeGreaterThan(prContextIndex);
    expect(diffIndex).toBeGreaterThan(priorFindingsIndex);
  });
});
