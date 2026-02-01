import Anthropic from '@anthropic-ai/sdk';
import { JudgeResultSchema } from './types.js';
import type { ExpectedBug, JudgeResult } from './types.js';
import type { Finding } from '../types/index.js';

/** Timeout for judge API calls in milliseconds */
const JUDGE_TIMEOUT_MS = 30000;

/** Model to use for judging */
const JUDGE_MODEL = 'claude-haiku-4-5';

/**
 * Build the prompt for the judge to evaluate a finding against an expected bug.
 */
function buildJudgePrompt(
  finding: Finding,
  expectedBug: ExpectedBug,
  codeContext?: string
): string {
  const sections: string[] = [];

  sections.push(`You are evaluating whether a code analysis finding correctly identifies a known bug.

Your task is to determine if the finding describes the same issue as the expected bug, not just any issue in the same area.`);

  sections.push(`## Expected Bug
**ID:** ${expectedBug.id}
**File:** ${expectedBug.file}
**Description:** ${expectedBug.bug}${expectedBug.severity ? `\n**Expected Severity:** ${expectedBug.severity}` : ''}${expectedBug.line ? `\n**Approximate Line:** ${expectedBug.line}` : ''}`);

  sections.push(`## Finding from Analyzer
**ID:** ${finding.id}
**Title:** ${finding.title}
**Description:** ${finding.description}
**Severity:** ${finding.severity}${finding.location ? `\n**Location:** ${finding.location.path}:${finding.location.startLine}${finding.location.endLine ? `-${finding.location.endLine}` : ''}` : ''}`);

  if (codeContext) {
    sections.push(`## Code Context
\`\`\`
${codeContext}
\`\`\``);
  }

  sections.push(`## Instructions
Determine if the finding correctly identifies the expected bug. Consider:
1. Is the finding describing the SAME issue (not a different problem in the same file)?
2. Does the finding's description match the core problem described in the expected bug?
3. Is the location reasonable (if provided)?

Do NOT penalize for:
- Different wording or terminology that describes the same underlying issue
- Slightly different severity levels
- Minor differences in line numbers

Respond with ONLY valid JSON in this exact format:
{"matches": true/false, "confidence": "high"/"medium"/"low", "reasoning": "brief explanation"}`);

  return sections.join('\n\n');
}

/**
 * Parse the judge's response into a structured result.
 */
function parseJudgeResponse(response: string): JudgeResult {
  // Try to extract JSON from the response
  let text = response.trim();

  // Strip markdown code fences if present
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    text = codeBlockMatch[1].trim();
  }

  // Find JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Default to non-match if we can't parse
    return {
      matches: false,
      confidence: 'low',
      reasoning: 'Failed to parse judge response',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      matches: false,
      confidence: 'low',
      reasoning: 'Failed to parse judge response JSON',
    };
  }

  const validated = JudgeResultSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      matches: false,
      confidence: 'low',
      reasoning: 'Judge response did not match expected schema',
    };
  }

  return validated.data;
}

/**
 * Judge whether a finding correctly identifies an expected bug.
 */
export async function judgeFinding(
  finding: Finding,
  expectedBug: ExpectedBug,
  options: {
    apiKey?: string;
    codeContext?: string;
  } = {}
): Promise<JudgeResult> {
  const { apiKey, codeContext } = options;

  if (!apiKey) {
    throw new Error('API key required for judge');
  }

  const prompt = buildJudgePrompt(finding, expectedBug, codeContext);

  const client = new Anthropic({ apiKey, timeout: JUDGE_TIMEOUT_MS });

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    return {
      matches: false,
      confidence: 'low',
      reasoning: 'No text response from judge',
    };
  }

  return parseJudgeResponse(content.text);
}

/**
 * Find the best matching finding for an expected bug based on file and proximity.
 * Returns null if no finding exists for the expected bug's file.
 */
export function findCandidateFinding(
  findings: Finding[],
  expectedBug: ExpectedBug
): Finding | null {
  // Filter findings to those in the same file
  const sameFile = findings.filter(
    (f) => f.location?.path === expectedBug.file
  );

  if (sameFile.length === 0) {
    return null;
  }

  // If only one finding in the file, return it
  const [onlyFinding] = sameFile;
  if (sameFile.length === 1 && onlyFinding) {
    return onlyFinding;
  }

  // If we have an expected line number, find the closest finding
  if (expectedBug.line !== undefined) {
    let closest: Finding | null = null;
    let closestDistance = Infinity;

    for (const finding of sameFile) {
      if (finding.location?.startLine !== undefined) {
        const distance = Math.abs(finding.location.startLine - expectedBug.line);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = finding;
        }
      }
    }

    if (closest) {
      return closest;
    }
  }

  // Return the first finding in the file
  const [firstFinding] = sameFile;
  return firstFinding ?? null;
}

/**
 * Check if a finding has already been matched to avoid double-counting.
 */
export function createFindingTracker(): {
  isUsed: (findingId: string) => boolean;
  markUsed: (findingId: string) => void;
} {
  const usedFindings = new Set<string>();

  return {
    isUsed: (findingId: string) => usedFindings.has(findingId),
    markUsed: (findingId: string) => usedFindings.add(findingId),
  };
}
