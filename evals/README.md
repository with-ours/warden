# Warden Evals

Tests the Warden harness, not the skills themselves. Given example code with known bugs (or no bugs), verify the system finds what it should and ignores what it shouldn't.

## What We're Testing

1. **Presence** - Did we find bugs when expected? Did we avoid false positives?
2. **Accuracy** - Do findings actually match the expected bugs? (LLM-as-judge)

## Directory Structure

```
evals/
├── skills/                      # Skill definitions for eval (isolated from prod)
│   └── sql-injection/
│       └── SKILL.md
├── sql-injection/               # Fixtures grouped by skill
│   ├── string-concat/           # Has bugs - should detect
│   │   ├── _fixture.json
│   │   └── db.ts
│   └── parameterized-safe/      # No bugs - should NOT detect
│       ├── _fixture.json        # expectedBugs: []
│       └── db.ts
└── sql-injection.eval.ts        # Evalite eval file
```

## Fixture Format

Each fixture directory contains:
- `_fixture.json` - Metadata and expected bugs
- Source files with intentional bugs (or clean code for negative cases)

```json
{
  "skill": "sql-injection",
  "description": "SQL injection via string concatenation",
  "expectedBugs": [
    {
      "id": "sql-1",
      "file": "db.ts",
      "bug": "SQL injection vulnerability where user input is concatenated directly into query string",
      "severity": "critical",
      "line": 8
    }
  ]
}
```

For negative test cases (clean code that should NOT trigger findings):
```json
{
  "skill": "sql-injection",
  "description": "Safe parameterized queries",
  "expectedBugs": []
}
```

## Running Evals

```bash
# Requires ANTHROPIC_API_KEY or WARDEN_ANTHROPIC_API_KEY in .env.local

# Run once
pnpm eval

# Watch mode for development
pnpm eval:watch
```

Results appear in the evalite UI at `localhost:3006`.

## Adding a New Eval

1. Create fixture directory: `evals/<skill>/<case>/`
2. Add `_fixture.json` with skill name, description, and expected bugs
3. Add source files with the bugs (or clean code)
4. Create `evals/<skill>.eval.ts`:

```typescript
import { evalite } from 'evalite';
import {
  loadSkillFixtures,
  runFixtureTask,
  PresenceScorer,
  AccuracyScorer,
} from '../src/eval/index.js';

const fixtures = loadSkillFixtures('<skill>');

evalite('<skill>', {
  data: fixtures.map((f) => ({
    input: f,
    expected: f.fixture.expectedBugs,
  })),
  task: runFixtureTask,
  scorers: [PresenceScorer, AccuracyScorer],
});
```

## Scorers

- **PresenceScorer** - F1 score based on found/missed/spurious counts
- **AccuracyScorer** - Percentage of true positives with high-confidence LLM-as-judge matches

## Philosophy

Evals are for observability, not gating. A low score doesn't fail the build; it tells you something changed. Investigate, don't panic.

Skills in `evals/skills/` are isolated from production skills. This lets us test specific behaviors without affecting real reviews.
