---
name: fix-pr
description: >-
  Fix all issues on a PR: review comments, failing CI checks
  (lint, format, build, tests), and push the results.
argument-hint: <pr-number>
disable-model-invocation: true
---

# Fix PR

## Overview

One-command workflow to get a PR green. Addresses two categories of issues:

1. **Review comments** - fetch, validate, and fix actionable reviewer feedback
2. **CI checks** - detect failing GitHub Actions (lint, format, build, tests), download logs, diagnose root causes, and apply fixes

Commit grouping depends on issue type and severity. All fixes are pushed at the end.

## Arguments

### Definitions

- **`<pr-number>`** (required): The pull request number to fix (e.g., `42`). Used to fetch review comments, CI check status, and push fixes.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Read every affected file before making changes - never edit blind
- Validate each review comment before acting; skip outdated, duplicate, or non-actionable feedback
- Fix production bugs found by tests - do not silence tests to make CI pass
- Verify fixes locally before committing (type-check, lint, run failing tests)
- Batch small fixes (a few lines each) into a single commit regardless of severity; isolate larger multi-file fixes into their own commits
- Collect comments that need a user decision rather than guessing - report them at the end
- If a CI fix and a review comment overlap, consolidate into one commit referencing both sources
- Push only once, after all commits are created

## Instructions

### Phase 0 - Identify the PR

```bash
gh pr view $0 --json number,url,headRefName --jq '{number, url, branch: .headRefName}'
```

If the PR does not exist, inform the user and stop.

### Phase 1 - Review Comments

#### 1.1 Fetch review comments

**Important:** Do not pipe `gh api` output through external tools (e.g., Python, Node) for parsing - backtick-heavy JSON can cause shell escaping issues. Instead, use `--jq` filters directly on the `gh api` call or read raw JSON output directly.

Inline review comments:

```bash
gh api repos/{owner}/{repo}/pulls/$0/comments --paginate \
  --jq '.[] | {id, node_id, author: .user.login, body, path, line, original_line, diff_hunk, in_reply_to_id, created_at}'
```

Top-level PR review bodies (not inline comments):

```bash
gh api repos/{owner}/{repo}/pulls/$0/reviews --paginate \
  --jq '.[] | {id, node_id, author: .user.login, state, body}'
```

General issue-style comments on the PR:

```bash
gh api repos/{owner}/{repo}/issues/$0/comments --paginate \
  --jq '.[] | {id, node_id, author: .user.login, body, created_at}'
```

If `--jq` filters produce no output but you expect comments, fall back to raw `gh api` without `--jq` and parse the full JSON directly.

Parse each comment to extract:

- **author**: who left the comment
- **body**: the comment text
- **path**: file path (for inline comments)
- **line / original_line**: line number context
- **diff_hunk**: surrounding code context
- **in_reply_to_id**: thread parent (skip replies that are just acknowledgments)
- **state**: for reviews, focus on `CHANGES_REQUESTED` and `COMMENTED`

#### 1.2 Validate comments

For each comment, determine if it is **valid and actionable**:

- **Valid**: The comment identifies a real issue (bug, missing handling, style violation, naming, logic error, performance concern, security issue) or requests a concrete change
- **Invalid / Skip**: The comment is a question with no action, a compliment, already addressed by another commit, outdated (file/line no longer exists), or contradicts project conventions in CLAUDE.md

Classify each valid comment by severity:

- **Critical**: Security vulnerabilities, data loss risks, correctness bugs
- **Major**: Logic errors, missing error handling, architectural violations, broken contracts
- **Minor**: Style, naming, formatting, small refactors, documentation tweaks

#### 1.3 Fix the comments

Read each affected file before making changes. Apply fixes for all valid comments:

- For **inline comments**: navigate to the referenced file and line, understand the surrounding context, and apply the requested change
- For **general review comments**: interpret the feedback and apply across relevant files
- If a comment is ambiguous but you can infer the intent from context, fix it and note your interpretation
- If a comment **requires a decision or user feedback** that you cannot resolve (e.g., "should we use approach A or B?", "is this the intended behavior?"), do NOT fix it - instead collect it to report to the user

#### 1.4 Commit review fixes

Group by code size, not severity:

- **Small fixes** (a few lines each, localized changes): batch all of them into a single commit - e.g., if 4 comments each need 3-8 lines changed, one commit is fine regardless of whether they are critical, major, or minor
- **Larger fixes** (span many files, significant refactors, or structurally unrelated): give each its own commit with a clear message describing what was fixed and why

The commit description should list the individual fixes applied.

**If there are no review comments (or none are actionable), skip this phase entirely.**

### Phase 2 - CI Checks

#### 2.1 Get check status

```bash
gh pr checks $0
```

This returns each check's name, status (pass/fail/pending), duration, and link.

If all checks pass, skip this phase.

If any checks are still `pending` or `in_progress`, wait for them to complete:

```bash
gh pr checks $0 --watch --fail-fast
```

Use a timeout so you don't wait forever (~3 minutes). If checks are still running after the timeout, report them as "in progress" and proceed to fix what has already failed.

#### 2.2 Download failure logs

For each failed check, get the logs:

```bash
# Get the run ID from the latest workflow run on this PR's branch
gh run list --branch {branch} --limit 1 --json databaseId --jq '.[0].databaseId'

# Download only the failed job logs
gh run view {run_id} --log-failed
```

If the run is still in progress (logs unavailable), use the API to get step-level info:

```bash
gh api repos/{owner}/{repo}/commits/{sha}/check-runs \
  --jq '.check_runs[] | select(.conclusion == "failure") | {name, output: .output}'
```

#### 2.3 Diagnose and categorize failures

Parse the failure logs and classify each failure:

| Check              | Common Failures                                   | How to Reproduce Locally              |
| ------------------ | ------------------------------------------------- | ------------------------------------- |
| **Lint & Format**  | ESLint errors, Prettier violations                | `pnpm check`                          |
| **Build**          | TypeScript compile errors, missing imports        | `npx tsc --noEmit -p {tsconfig_path}` |
| **Test**           | Assertion failures, runtime errors, missing mocks | `pnpm --filter {package} test`        |
| **Migrate & Seed** | Migration SQL errors, seed data conflicts         | Check migration files and schema      |

For each failure, determine:

- **Root cause**: What specific code change caused this failure?
- **Fix scope**: Is it a simple one-line fix, or does it require deeper changes?
- **Confidence**: Can you fix it with high confidence, or does it need user input?

#### 2.4 Apply CI fixes

Read the affected files and apply fixes. Common patterns:

- **Lint/format**: Run the auto-fixer (`pnpm format` / `pnpm lint --fix`) if available, or manually fix the violations
- **Build errors**: Fix type errors, missing imports, incorrect signatures
- **Test failures**: Update assertions, fix broken mocks, adjust test setup to match code changes. Only modify tests when the production code change is intentional and correct - do NOT change production code just to make a stale test pass without understanding why

**Important**: If a test failure suggests a real bug in the production code (not just a stale test), treat it as a **Critical** issue. Fix the production code, not the test.

#### 2.5 Verify fixes locally

After applying fixes, verify locally before committing:

- **Lint/format**: Run `pnpm check`
- **Build**: Run `npx tsc --noEmit` on the affected project
- **Tests**: Run the specific failing tests

If verification fails, iterate on the fix. Do not push code that still fails locally.

#### 2.6 Commit CI fixes

Apply the same grouping rule as review fixes - batch small, localized fixes into one commit; isolate larger multi-file changes:

- **Lint/format fixes**: Typically one commit, e.g. `style: fix lint and format violations`
- **Build fixes**: Typically one commit, e.g. `fix: resolve build errors`
- **Test fixes**: Per-test or grouped, e.g. `fix: update tests for {feature}` or `fix: {describe the bug fixed}`

If a CI fix overlaps with a review comment fix (e.g., reviewer pointed out the same issue that lint caught), consolidate into one commit and note both sources.

### Phase 3 - Push, Respond, and Report

#### 3.1 Push all commits

```bash
git push
```

#### 3.2 Resolve review comments on GitHub

After pushing, close resolved comments and reply only to comments that could not be fixed. Do **not** reply to fixed comments - just resolve them silently.

##### Resolving fixed comments

There are two resolution mechanisms depending on comment type:

**Inline review comments** (from `/pulls/$0/comments`) live inside review threads. Resolve the thread via GraphQL:

1. Get the thread ID by querying review threads:

   ```bash
   gh api graphql -f query='{ repository(owner: "{owner}", name: "{repo}") {
     pullRequest(number: $0) {
       reviewThreads(first: 100) {
         nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
       }
     }
   } }'
   ```

2. Match each fixed inline comment's `databaseId` to the thread's `id`, then resolve:

   ```bash
   gh api graphql -f query='mutation {
     resolveReviewThread(input: {threadId: "{thread_node_id}"}) {
       thread { isResolved }
     }
   }'
   ```

**Issue-style comments** (from `/issues/$0/comments`) - including bot review summaries - cannot be "resolved" like threads. Instead, minimize (hide) them with reason `RESOLVED`:

```bash
gh api graphql -f query='mutation {
  minimizeComment(input: {subjectId: "{comment_node_id}", classifier: RESOLVED}) {
    minimizedComment { isMinimized minimizedReason }
  }
}'
```

Use the comment's `node_id` (e.g., `IC_kwDO...`) as the `subjectId`.

##### Replying to unfixed comments

Only reply when a comment **could not be fixed** or **needs user input**. Two different reply mechanisms:

**Important formatting rule:** When referencing numbered findings in GitHub comments (replies, summaries), never use `#N` syntax (e.g., `#4`). GitHub auto-links `#N` to issues/PRs with that ID, creating broken or misleading references. Instead use plain numbered references like `4.` or `Finding 4` or `(item 4)`.

**Inline review comments** - reply directly in the review thread:

```bash
gh api repos/{owner}/{repo}/pulls/$0/comments \
  -f body="{explanation}" \
  -F in_reply_to={comment_id}
```

**Issue-style / root comments** - cannot be replied to directly. Post a new issue comment with a quote block referencing the original:

```bash
gh api repos/{owner}/{repo}/issues/$0/comments \
  -f body="> {quoted excerpt from original comment}

{explanation of why it was not fixed or what decision is needed}"
```

##### What to do for each comment category

| Category                       | Reply?             | Resolve?                                |
| ------------------------------ | ------------------ | --------------------------------------- |
| Fixed (inline)                 | No                 | Yes - `resolveReviewThread`             |
| Fixed (issue-style)            | No                 | Yes - `minimizeComment` with `RESOLVED` |
| Needs user input (inline)      | Yes - direct reply | No - leave open                         |
| Needs user input (issue-style) | Yes - quote reply  | No - leave open                         |
| Skipped / invalid / bot noise  | No                 | No                                      |

#### 3.3 Report to the user

Summarize what was done across all phases:

**Review Comments:**

- **Fixed**: List of comments addressed, grouped by commit
- **Skipped (invalid)**: List of comments that were not actionable, with brief reason
- **Needs user input**: List of comments that require a decision or clarification

**CI Checks:**

- **Fixed**: List of failing checks that were fixed, with root cause and what was changed
- **Still failing**: Any checks that could not be fixed, with diagnosis and suggested next steps
- **In progress**: Checks that were still running and couldn't be evaluated

## Output Guidance

Present a human-readable summary with clear sections:

- PR number and URL
- Review comments: total, fixed, skipped, needs input
- CI checks: total, passing, fixed, still failing, in progress
- Number of commits created
- Whether changes were pushed
