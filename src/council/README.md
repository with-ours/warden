# Council Implementation Guide

Implementation reference for council members. For philosophy and design goals, see [specs/council-of-warden.md](/specs/council-of-warden.md).

## Architecture

```
council/
├── types.ts       # Core interfaces
├── member.ts      # defineCouncilMember() factory
├── convene.ts     # LLM call orchestration
├── json.ts        # Response parsing utilities
├── members/       # Individual council members
│   ├── index.ts   # Registry
│   └── *.ts       # Member definitions
└── index.ts       # Public API
```

## Current Members

### `fixJudge`

Judges whether a patch addressed a reported issue and if so, whether successfully.

```typescript
const verdict = await conveneWithFallback(
  fixJudge,
  { comment, patch },
  { apiKey },
  { status: 'not_attempted', reasoning: 'Evaluation failed' }
);

// verdict.status: 'not_attempted' | 'attempted_failed' | 'resolved'
```

### `duplicateJudge`

Judges whether new findings are duplicates of existing comments.

```typescript
const result = await convene(
  duplicateJudge,
  { findings, existingComments },
  { apiKey }
);

// result.verdict: [{ findingIndex: 1, existingIndex: 2 }, ...]
```

## Adding a Council Member

### 1. Define the member

```typescript
// src/council/members/code-smell-judge.ts
import { z } from 'zod';
import { defineCouncilMember } from '../member.js';

export interface CodeSmellJudgeInput {
  code: string;
  pattern: string;
}

export const CodeSmellJudgeVerdictSchema = z.object({
  detected: z.boolean(),
  reasoning: z.string(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
});

export type CodeSmellJudgeVerdict = z.infer<typeof CodeSmellJudgeVerdictSchema>;

export const codeSmellJudge = defineCouncilMember<CodeSmellJudgeInput, CodeSmellJudgeVerdict>({
  name: 'code-smell-judge',
  description: 'Judges whether code exhibits a specific code smell pattern',

  buildPrompt: ({ code, pattern }) => `You are analyzing code for a specific pattern.

## Code
\`\`\`
${code}
\`\`\`

## Pattern to detect
${pattern}

## Task
Determine if this code exhibits the described pattern.

Return ONLY a JSON object:
{"detected": true/false, "reasoning": "brief explanation", "severity": "low|medium|high"}`,

  schema: CodeSmellJudgeVerdictSchema,
});
```


### 2. Register the member

```typescript
// src/council/members/index.ts
export { codeSmellJudge } from './code-smell-judge.js';
export type { CodeSmellJudgeInput, CodeSmellJudgeVerdict } from './code-smell-judge.js';

import { codeSmellJudge } from './code-smell-judge.js';

export const councilMembers = {
  // ... existing members
  codeSmellJudge,
} as const;
```

### 3. Use the member

```typescript
import { convene, conveneWithFallback, codeSmellJudge } from '../council/index.js';

// With explicit error handling
const result = await convene(codeSmellJudge, { code, pattern }, { apiKey });
if (result.success) {
  console.log(result.verdict.detected);
} else {
  console.error(result.error);
}

// With fallback (simpler)
const verdict = await conveneWithFallback(
  codeSmellJudge,
  { code, pattern },
  { apiKey },
  { detected: false, reasoning: 'Evaluation unavailable' }
);
```

## Conventions

### Naming

- Member names use kebab-case with `-judge` suffix: `fix-judge`, `duplicate-judge`
- TypeScript identifiers use camelCase: `fixJudge`, `duplicateJudge`
- Input types: `{MemberName}Input`
- Verdict types: `{MemberName}Verdict`
- Schema constants: `{MemberName}VerdictSchema`

### Prompts

1. **Start with context** - Explain what the member is analyzing
2. **Present the data** - Use markdown formatting for clarity
3. **Define the task** - Be specific about what judgment is needed
4. **Specify the output format** - Always end with the exact JSON format expected

```typescript
buildPrompt: (input) => `You are analyzing [context].

## [Section 1]
${input.data1}

## [Section 2]
${input.data2}

## Task
Determine if [specific question].

Consider:
- [Consideration 1]
- [Consideration 2]

Return ONLY a JSON object in this exact format:
{"field": true/false, "reasoning": "brief explanation"}`
```

### Schemas

- Use Zod for runtime validation
- Always include a `reasoning` field for explainability
- Keep verdicts simple - complex logic belongs in the caller

### Configuration

Members can customize:
- `maxTokens` - Response length limit (default: 512)
- `timeout` - Request timeout in ms (default: 30000)

```typescript
export const verboseJudge = defineCouncilMember({
  // ...
  maxTokens: 1024,  // Needs longer responses
  timeout: 60000,   // Complex analysis
});
```

## Testing

### Unit tests for prompts

```typescript
describe('codeSmellJudge', () => {
  it('builds prompt with code and pattern', () => {
    const prompt = codeSmellJudge.buildPrompt({
      code: 'function foo() {}',
      pattern: 'empty function',
    });

    expect(prompt).toContain('function foo()');
    expect(prompt).toContain('empty function');
  });
});
```

### Integration tests with mocked LLM

See `convene.test.ts` for examples of mocking the Anthropic client.

## Introspection

```typescript
import { councilMembers, listCouncilMembers } from '../council/index.js';

// List all members
const members = listCouncilMembers();
// [{ name: 'fix-judge', description: '...' }, ...]

// Access member metadata
councilMembers.fixJudge.name        // 'fix-judge'
councilMembers.fixJudge.description // 'Judges whether...'
councilMembers.fixJudge.maxTokens   // 512 (or custom value)
```

## JSON Extraction

The council provides utilities for parsing LLM responses:

```typescript
import { extractJson, extractAndParseJson, extractBalancedJson } from '../council/index.js';

// Extract first JSON from text with surrounding prose
extractJson('Result: {"foo": "bar"} done')  // '{"foo": "bar"}'

// Extract and parse in one step
extractAndParseJson('Result: {"foo": "bar"}')  // { foo: 'bar' }

// Handle complex nested structures with balanced brace matching
extractBalancedJson('{"a": {"b": "}"}}')  // '{"a": {"b": "}"}}'
```
