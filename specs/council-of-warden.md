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

Council members make one judgment per call. They don't:
- Explore codebases
- Make multi-step decisions
- Read files or call APIs
- Take actions with side effects

If a task requires exploration, tool use, or multi-step reasoning, it belongs in a skill agent (SDK), not a council member.

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

Evaluates whether a code patch addressed a reported issue.

**Input**: A comment (finding) and a patch (diff)

**Verdict**:
- `not_attempted` - The patch doesn't try to address this issue
- `attempted_failed` - The patch tries but doesn't succeed
- `resolved` - The patch correctly fixes the issue

**Used by**: Follow-up commit evaluation. When a developer pushes after Warden posts comments, this judge determines if they tried to fix Warden's findings.

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
| Multi-file analysis | Requires exploration | SDK agent |
| Code generation | Action, not judgment | Skill or dedicated tool |
| Complex reasoning chains | Multiple judgments needed | SDK agent or orchestrator |
| Parsing/extraction | Data transformation, not judgment | Utility function |

### Signs You Need an Agent Instead

- "First check X, then based on that, check Y"
- "Find all instances of this pattern"
- "Generate code that fixes this"
- "Read these files and decide..."

These require tool access, state, or multi-step reasoning - use an SDK agent.
