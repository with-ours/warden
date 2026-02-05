# Fix Evaluation

How Warden determines whether follow-up commits addressed previously reported issues.

## User Stories

### Automatic Resolution of Fixed Issues

**As a developer**, when I push a commit that fixes an issue Warden flagged, I want:
- The comment automatically resolved
- No manual dismissal required
- Clear indication that my fix was recognized

**Expected behavior**: Warden evaluates my changes and resolves comments for issues that are fixed.

### Fixes in Different Locations

**As a developer**, I might fix an issue by:
- Changing the flagged line directly
- Adding validation in a helper function
- Modifying a shared utility
- Updating imports or configuration

**Expected behavior**: Warden recognizes fixes regardless of where the change occurs, not just at the original comment location.

### No False Resolutions

**As a developer**, I don't want Warden to resolve comments when:
- I made unrelated changes to the file
- My fix attempt was incomplete or incorrect
- I changed code nearby but didn't address the issue

**Expected behavior**: Comments stay open unless the issue is actually fixed.

### Feedback on Failed Fixes

**As a developer**, when my fix attempt doesn't work, I want to know:
- That Warden noticed I tried
- Why the fix was insufficient
- What's still wrong

**Expected behavior**: Warden replies to the thread explaining what's missing.

---

## How It Works

### Trigger

Fix evaluation runs on `pull_request.synchronize` events (when new commits are pushed to a PR). It evaluates all unresolved Warden comments against the changes.

### Evaluation Flow

```
1. Fetch all unresolved Warden comments on the PR
2. Fetch patches (diffs) for the new commit
3. For each comment (up to 20):
   a. Provide the judge with:
      - The original issue (title, description, location)
      - Code at the issue location before this commit
      - List of all files that changed
   b. Judge explores using tools:
      - get_file_diff(path) - see what changed in a file
      - get_file_at_commit(path, before|after) - see file content
   c. Judge returns verdict: not_attempted, attempted_failed, or resolved
4. Cross-check against current findings (re-detection overrides LLM)
5. Resolve fixed comments, reply to failed attempts
```

### Verdicts

| Verdict | Meaning | Action |
|---------|---------|--------|
| `not_attempted` | Changes unrelated to this issue | No action |
| `attempted_failed` | Fix attempted but incorrect/incomplete | Reply with feedback |
| `resolved` | Issue is fixed | Resolve comment thread |

### Re-detection Override

If the same issue is detected again in the current analysis (matching by content hash or title), Warden treats the fix as failed regardless of the judge's verdict. This catches cases where the judge incorrectly thinks something is fixed.

---

## The Fix Judge

The fix judge is a council member with tool access. Unlike other council members that make single-turn judgments, the fix judge can explore the codebase to understand changes.

### Tools

| Tool | Purpose |
|------|---------|
| `get_file_diff(path)` | See the unified diff for a changed file |
| `get_file_at_commit(path, before\|after)` | See file content before or after the commit |

### Why Tools?

A fix for "SQL injection at db.ts:42" might be:
- Parameterized query at db.ts:42 (obvious)
- Input validation in validateInput() at utils.ts:15 (different file)
- Escaping helper added at db.ts:120 (same file, different location)
- Configuration change in security.config.ts (indirect)

Without tools, the judge would need all potentially-relevant code pre-fetched. With tools, it can explore based on the specific issue and changes.

### Prompt Structure

The judge receives:
1. **The original report** - title, description, location, suggested fix (if any)
2. **Code before this commit** - ~20 lines around the issue location
3. **List of changed files** - so it knows where to look

It then uses tools to examine relevant changes and determine if the issue was addressed.

---

## Examples

### Direct Fix

```
Original issue: SQL injection at db.ts:42
Developer changes: db.ts modified at line 42

Judge:
1. Calls get_file_diff("db.ts")
2. Sees parameterized query replacing string interpolation
3. Returns: resolved
```

### Fix in Helper Function

```
Original issue: XSS vulnerability at render.ts:15
Developer changes: utils.ts modified (added escapeHtml function)

Judge:
1. Calls get_file_diff("utils.ts")
2. Sees new escapeHtml function
3. Calls get_file_at_commit("render.ts", "after")
4. Sees render.ts now imports and uses escapeHtml
5. Returns: resolved
```

### Unrelated Change

```
Original issue: Missing null check at api.ts:30
Developer changes: api.ts modified at line 100 (different function)

Judge:
1. Calls get_file_diff("api.ts")
2. Sees changes are in a different function
3. Calls get_file_at_commit("api.ts", "after", 25, 35)
4. Sees null check still missing
5. Returns: not_attempted
```

### Incomplete Fix

```
Original issue: Race condition in async handler
Developer changes: Added mutex but didn't cover all code paths

Judge:
1. Examines the diff
2. Sees mutex added but release missing in error path
3. Returns: attempted_failed, "Mutex acquired but not released on error"
```

---

## Limitations

### Evaluation Cap

Maximum 20 comments evaluated per push to limit API costs. If a PR has more unresolved comments, some won't be checked until later pushes.

### Tool Iterations

The judge has up to 5 tool calls per evaluation. Complex fixes spanning many files may not be fully explored.

### Semantic Understanding

The judge uses Claude Haiku for speed. Subtle or complex fixes may be misclassified. Re-detection provides a safety net for false "resolved" verdicts.

### No Action on Not Attempted

When the judge returns `not_attempted`, no action is taken. The comment remains open. This is intentional - we don't want to spam threads with "still not fixed" messages on every unrelated push.

---

## Configuration

Fix evaluation runs automatically when:
- The Anthropic API key is configured
- There are unresolved Warden comments
- New commits are pushed to the PR

No additional configuration is required.

---

## Cost Tracking

Fix evaluation tracks LLM token usage and cost across all evaluations. Usage is accumulated from:
- Initial judge calls
- Tool iterations (each tool response requires another API call)
- Failed calls (partial usage is still tracked)

The result includes aggregated usage stats:

```typescript
{
  evaluated: 5,
  toResolve: [...],
  toReply: [...],
  usage: {
    inputTokens: 15000,
    outputTokens: 2500,
    costUSD: 0.022
  }
}
```

This enables monitoring of council costs at the session level. The PR workflow logs usage when fix evaluation runs.

---

## Relationship to Other Specs

- **[Comment Lifecycle](comment-lifecycle.md)**: Fix evaluation is one way comments get resolved
- **[Council of Warden](council-of-warden.md)**: The fix judge is a council member (with tools)
- **[GitHub PR Review](github-pr-review.md)**: Resolution may trigger approval state changes
