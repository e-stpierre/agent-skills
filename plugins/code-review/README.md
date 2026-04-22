# Code Review

## Overview

High-signal code review that works the same way locally and in CI. The skill flags only bugs, security issues, and clear CLAUDE.md violations in the diff -- no style nitpicks, no praise, no summaries of what the PR does well. It produces the review as markdown text; routing that text (stdout, PR comment, file, CI annotation) is the caller's responsibility.

- `/code-review:code-review` - Review local changes (auto-detects staged, unstaged, or branch-vs-default)
- `/code-review:code-review PR 123` - Review an open GitHub pull request via `gh`
- `/code-review:code-review main` - Review the current branch against `main`

## Skills

| Skill                      | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `/code-review:code-review` | Review a diff (local changes, a ref range, or a PR) for high-signal issues |

## Complete Examples

### /code-review:code-review

**Description:** Produce a high-signal review of a diff. Accepts an optional target; with no target it reviews local changes.

**Arguments:**

- `[target]` - What to review. Omit for local changes. Accepts `staged`, `unstaged`, a ref (`main`, `origin/main`), a range (`main..HEAD`), or a PR reference (`PR 123`, `#123`).

**Examples:**

```bash
# Review all local changes (staged + unstaged, or branch vs default if clean)
/code-review:code-review

# Review only staged changes, e.g. as a pre-commit sanity check
/code-review:code-review staged

# Review the current branch against main
/code-review:code-review main

# Review an explicit range
/code-review:code-review origin/main..HEAD

# Review a GitHub pull request (requires gh to be authenticated)
/code-review:code-review PR 123
/code-review:code-review #123
```

**CI usage:**

Because the skill outputs plain markdown and performs no write-side effects, CI pipelines can capture the result and post it wherever they want -- a PR comment, a check run summary, a Slack webhook, or a file. The skill itself does not call `gh pr comment` or any inline-comment API.
