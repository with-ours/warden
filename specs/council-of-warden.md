# The Council of Warden

The Council is Warden's system for making quick, focused LLM judgments. Council members are lightweight evaluators that answer specific yes/no or classification questions.

## Philosophy

### Judges, Not Workers

Council members render verdicts on specific questions. They observe and judge; they do not act.

| Council Member | Question |
|----------------|----------|
| `fixJudge` | "Did this patch fix the issue?" |
| `duplicateJudge` | "Are these findings duplicates?" |

A judge might recommend an action as part of its verdict (e.g., "this is vulnerable, here's a suggested fix"), but the caller decides whether to act on that recommendation.

### Single-Turn, Focused Judgments

Council members make one judgment per call. Most members don't:
- Explore codebases
- Make multi-step decisions
- Read files or call APIs
- Take actions with side effects

**Exception**: Some judgments require bounded exploration. The `fixJudge` has tools to examine diffs and file content because determining "did this fix the issue?" may require looking at changes in multiple locations. See [Fix Evaluation](fix-evaluation.md) for details.

If a task requires unbounded exploration or multi-step reasoning, it belongs in a skill agent (SDK), not a council member.

## When to Use What

| Need | Solution |
|------|----------|
| Quick judgment on a specific question | Council member |
| Multi-step analysis with tool access | SDK agent (skill) |
| Data transformation or parsing | Utility function |
| Actions (posting comments, resolving threads) | Caller code |

### Decision Tree

```
Is this a single, focused judgment?
├── Yes → Council member
│   └── Does it need to suggest an action? → Include in verdict schema
└── No, needs exploration or tools → SDK agent
```

## Current Members

### `fixJudge`

Evaluates whether code changes addressed a reported issue.

**Input**:
- A comment (the original finding with title, description, location)
- List of changed files
- Code at the issue location before the commit

**Tools** (bounded exploration):
- `get_file_diff(path)` - See what changed in a file
- `get_file_at_commit(path, before|after)` - See file content

**Verdict**:
- `not_attempted` - Changes unrelated to this issue
- `attempted_failed` - Fix attempted but incorrect/incomplete
- `resolved` - The issue is fixed

**Used by**: Follow-up commit evaluation. When a developer pushes after Warden posts comments, this judge explores the changes to determine if each issue was addressed. See [Fix Evaluation](fix-evaluation.md) for the full flow.

### `duplicateJudge`

Identifies semantic duplicates between new findings and existing PR comments.

**Input**: List of new findings and existing comments

**Verdict**: Array of `{ findingIndex, existingIndex }` pairs indicating which findings duplicate which existing comments

**Used by**: Deduplication pipeline. Catches cases where the same issue is described differently (e.g., "SQL injection" vs "unsanitized query").

## Design Principles

### Fast and Cheap

Council members use Claude Haiku for speed and cost efficiency. A judgment should complete in 1-2 seconds. If analysis takes longer, it probably belongs in a skill agent.

### Structured Output

Verdicts are JSON objects validated by Zod schemas. Every verdict includes a `reasoning` field for explainability. The LLM returns structured data; parsing is handled automatically.

### Pure Functions

Council members are stateless. Given the same input, they produce the same verdict (modulo LLM non-determinism). They have no side effects - the caller handles all actions based on the verdict.

### Fallback-Friendly

Council calls can fail (API errors, malformed responses). Callers should handle failures gracefully:

```
conveneWithFallback(judge, input, options, fallbackVerdict)
```

The fallback verdict is returned on any error, ensuring the system degrades gracefully.

### Usage Tracking

Every council call tracks token usage and cost. Usage is accumulated across all API calls, including tool iterations:

```typescript
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}
```

Usage is always returned, even on failure (may be partial if the call failed mid-way). Callers should aggregate usage when making multiple council calls:

```typescript
const result1 = await convene(judge1, input1, options);
const result2 = await convene(judge2, input2, options);
const totalUsage = addUsage(result1.usage, result2.usage);
```

This enables global tracking of LLM costs across a Warden session.

## Future Members

Potential council members that fit the pattern:

- **Severity classifier** - "What severity is this finding?"
- **False positive detector** - "Is this finding likely a false positive?"
- **Relevance judge** - "Is this comment still relevant after the code changed?"

Each answers a single, focused question with a structured verdict.

## Anti-Patterns

### Don't Use Council Members For

| Anti-Pattern | Why | Better Approach |
|--------------|-----|-----------------|
| Unbounded exploration | No clear scope | SDK agent |
| Code generation | Action, not judgment | Skill or dedicated tool |
| Complex reasoning chains | Multiple judgments needed | SDK agent or orchestrator |
| Parsing/extraction | Data transformation, not judgment | Utility function |

### When Tools Are Appropriate

Council members can have tools when:
- The judgment requires examining specific, bounded context
- The tool calls are exploratory (reading), not actions (writing)
- There's a clear limit on iterations (e.g., max 5 tool calls)
- The question is still focused: "did X happen?" not "find all X"

Example: `fixJudge` has tools because "did this commit fix the issue?" may require looking at diffs in multiple files, but the scope is bounded (one commit, one issue).

### Signs You Need an Agent Instead

- "Find all instances of this pattern" (unbounded search)
- "Generate code that fixes this" (action, not judgment)
- "Analyze the entire codebase for..." (unbounded scope)
- "Keep trying until it works" (iterative refinement)

These require unbounded exploration or actions - use an SDK agent.
