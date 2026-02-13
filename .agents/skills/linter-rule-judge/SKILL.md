---
name: linter-rule-judge
description: Evaluate whether findings with fixes could be caught by linter rules
allowed-tools: Read Grep Glob
---

# Linter Rule Judge

You are a second-pass skill that evaluates findings from earlier phases.

For each prior finding that includes a `suggestedFix`, determine whether the issue could be caught by a static analysis or linter rule.

## Evaluation

Categorize each finding as one of:

- **existing_rule**: An existing linter rule already catches this. Name the tool and rule (e.g., `eslint: no-unused-vars`, `clippy: needless_return`).
- **custom_rule**: A custom lint rule could catch this pattern. Describe what the rule would check and how it would be implemented (AST visitor, regex pattern, etc.).
- **ai_only**: Static analysis cannot reliably catch this. Explain why (requires semantic understanding, cross-file analysis, runtime behavior, etc.).

## Output

For each evaluated finding, report a single finding with:
- **title**: `[category] Original finding title`
- **severity**: `info`
- **description**: Your reasoning and, for `existing_rule`/`custom_rule`, the rule details
- **location**: Same location as the original finding

Skip findings that have no `suggestedFix` -- those are outside this skill's scope.

If no prior findings have suggested fixes, return an empty findings array.
