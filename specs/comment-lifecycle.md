# Comment Lifecycle

How Warden manages PR comments throughout their lifecycle: posting, deduplication, attribution, and resolution.

## User Stories

### Avoiding Comment Noise

**As a developer**, I don't want to see the same issue flagged multiple times when:
- Warden already posted about it on a previous push
- Another skill detected the same issue
- A teammate or another bot already pointed it out

**Expected behavior**: One comment per issue, regardless of how many times or ways it was detected.

### Knowing Who Found What

**As a developer**, I want to know which skills or reviewers identified an issue so I can:
- Understand different perspectives on the same problem
- Know if multiple independent checks agree
- See if Warden agrees with human feedback

**Expected behavior**: Comments show attribution for all skills that detected the issue.

### Cleaning Up Fixed Issues

**As a developer**, when I fix an issue that Warden flagged, I want the comment resolved automatically so:
- My PR doesn't have stale feedback
- I can see what's actually still wrong
- Reviewers see current state, not history

**Expected behavior**: Fixed issues are marked resolved; unfixed issues remain visible.

### Approving After Fixes

**As a developer**, when I address all blocking issues Warden found, I want:
- The "changes requested" status cleared
- Indication that Warden is satisfied
- No manual dismissal required

**Expected behavior**: Warden dismisses its review when previously-blocking issues are resolved.

---

## Deduplication

### Detection Methods

Warden uses two methods to detect duplicates:

| Method | Speed | Accuracy | When Used |
|--------|-------|----------|-----------|
| Content hash | Instant | Exact matches only | Always |
| Semantic (LLM) | ~2s per comparison | Catches rephrased issues | When API key provided |

**Content hash**: SHA256 of `title + description`, stored in a hidden marker in each comment.

**Semantic matching**: Claude Haiku compares new findings against existing comments at similar locations. Catches cases where the same issue is described differently.

### Same Finding from Warden

When Warden detects an issue it already posted about:

| Scenario | Action |
|----------|--------|
| Same skill, same finding | Skip (exact duplicate) |
| Different skill, same finding | Update comment attribution |
| Same skill, slightly different text | Skip (hash or semantic match) |

**Attribution update example**:
```
Before: <sub>warden: security-review</sub>
After:  <sub>warden: security-review, code-quality</sub>
```

### Same Finding from Others

When Warden detects an issue already raised by a human or another bot:

| Scenario | Action |
|----------|--------|
| Exact match (hash) | Add reaction, skip comment |
| Semantic match | Add reaction, skip comment |

Warden never modifies external comments. The reaction signals "we also found this."

### Location Tolerance

Findings match existing comments if:
- Same file path
- Within 5 lines (handles minor code movement)
- Content hash matches OR title matches exactly

---

## Auto-Resolution

### When Comments Are Resolved

A Warden comment is automatically resolved when:

1. **Issue is fixed**: The fix judge determines changes addressed the issue (see [Fix Evaluation](fix-evaluation.md))
2. **No longer detected**: No matching finding in current analysis
3. **File removed**: The commented file no longer exists in the PR
4. **File out of scope**: File was reverted or excluded from analysis

On follow-up commits, Warden evaluates all unresolved comments (up to 20) using the fix judge. The judge examines the changes and determines if each issue was addressed, regardless of where the fix occurs.

### Safety Guards

| Guard | Purpose |
|-------|---------|
| Only Warden comments | Never touches human or external bot comments |
| All triggers must succeed | Won't resolve if analysis incomplete |
| Max 50 per run | Prevents runaway resolution |
| Requires `contents:write` | Fails gracefully if permission missing |

### What Happens

- Comment thread marked as "resolved" in GitHub UI
- Comment remains visible (grayed out)
- User can reopen if resolution was wrong

---

## PR Approval Flow

### State Transitions

| Previous State | Current Findings | New State |
|----------------|------------------|-----------|
| None | Blocking | REQUEST_CHANGES |
| None | Non-blocking | COMMENT |
| None | None | No review |
| CHANGES_REQUESTED | Blocking | REQUEST_CHANGES |
| CHANGES_REQUESTED | Non-blocking | DISMISS |
| CHANGES_REQUESTED | None | DISMISS |
| APPROVED | Blocking | REQUEST_CHANGES |
| APPROVED | Non-blocking | COMMENT |
| COMMENTED | Any | (follow "None" rules) |

"Blocking" means findings at or above the `failOn` severity threshold.

*"Current Findings" counts ALL unresolved blocking issues:
- New findings from this analysis run
- Existing unresolved Warden comments from previous runs

Approval requires ALL blocking issues resolved. See "Partial Fix" example.

### Definitions

**Blocking**: Any unresolved comment posted by Warden at or above the `failOn` severity. These prevent PR approval.

**Resolved**: A comment is resolved when either:
- Warden resolves it (fix evaluation detected the issue was fixed)
- User resolves it (manually marked resolved in GitHub UI)

Either resolution type counts - Warden doesn't distinguish.

**Important**: Approval only occurs when `failOn` is configured. Without an active threshold, Warden uses COMMENT even if it previously requested changes. This prevents accidental approval when configuration changes between runs.

### Review Dismissal

When all previously reported issues are resolved, Warden dismisses its CHANGES_REQUESTED review:

> All previously reported issues have been resolved.

This clears the blocking state without approving the PR.

### Bot Identity

Warden only considers its own previous reviews when deciding to approve. Reviews from other bots (dependabot, renovate, etc.) are ignored. Warden identifies itself by the authenticated GitHub App's login.

---

## Cross-Trigger Deduplication

When multiple triggers run on the same PR:

1. First trigger posts findings normally
2. Subsequent triggers check against:
   - Pre-existing comments (from previous runs)
   - Comments just posted by earlier triggers (same run)
3. Duplicates are handled as described above

This prevents the same issue from being posted multiple times even when detected by multiple skills in the same Warden run.

---

## Examples

### Multiple Skills Find Same Issue

```
Run 1: security-review finds SQL injection at db.ts:42
Run 2: code-quality also detects it

Result:
- One comment at db.ts:42
- Attribution: "warden: security-review, code-quality"
```

### Human Found It First

```
Human reviewer comments: "This looks like SQL injection"
Warden runs and detects the same issue

Result:
- Human's comment unchanged
- Eyes reaction added to human's comment
- No Warden comment posted
```

### Issue Fixed (Direct)

```
Run 1: Warden posts "SQL injection" at db.ts:42
Developer fixes the vulnerability at db.ts:42
Run 2: Fix judge examines the diff and confirms fix

Result:
- Original comment marked resolved
- PR approved (if previously CHANGES_REQUESTED)
```

### Issue Fixed (Indirect)

```
Run 1: Warden posts "SQL injection" at db.ts:42
Developer adds sanitization in utils.ts and imports it
Run 2: Fix judge explores changes, finds the fix in utils.ts

Result:
- Original comment marked resolved
- PR approved (if previously CHANGES_REQUESTED)
```

### Partial Fix

```
Run 1: Warden posts 3 critical findings
Developer fixes 2 of them
Run 2: Warden finds 1 remaining

Result:
- 2 fixed comments marked resolved
- 1 comment remains open
- PR still shows CHANGES_REQUESTED
```

---

## Limitations

### Fix Detection

The fix judge evaluates all unresolved comments on each push, but:
- Maximum 20 comments evaluated per push (to limit API costs)
- Judge has up to 5 tool calls per evaluation
- Complex fixes spanning many files may not be fully understood

If the judge incorrectly marks something as fixed, re-detection provides a safety net: if the same issue appears in the current analysis, the comment stays open.

### Location Tolerance

Findings match existing comments if within 5 lines. If code moves more than 5 lines during refactoring:
- Original comment may be incorrectly marked as "stale"
- New comment posted at the new location
- Results in temporary duplicate (old resolved, new posted)

### Semantic Matching Requires API Key

Without an Anthropic API key:
- Only exact content hash matching is used
- Near-duplicates (same issue, different wording) may be posted
- External comment matching is less accurate

### GitHub App Required for Approval

The approval flow requires a GitHub App token to reliably identify Warden's own reviews. When using a PAT or `GITHUB_TOKEN`:
- Approval flow is skipped
- Previous CHANGES_REQUESTED state is not cleared automatically
- User must dismiss the review manually

### CLI vs GitHub Action

| Feature | CLI (`warden run`) | GitHub Action |
|---------|-------------------|---------------|
| Finds issues | Yes | Yes |
| Posts PR comments | No | Yes |
| Resolves stale comments | No | Yes |
| Approval flow | No | Yes |
| Tracks review state | No | Yes |

The CLI is for local development and CI checks. Full comment lifecycle features require the GitHub Action.

---

## Permissions

| Permission | Required For |
|------------|--------------|
| `pull_requests: write` | Posting comments, reactions |
| `contents: write` | Resolving comment threads |
| `checks: write` | Creating/updating check runs |

Note: `contents: write` is required for thread resolution due to a GitHub API quirk. See [community discussion](https://github.com/orgs/community/discussions/44650).
