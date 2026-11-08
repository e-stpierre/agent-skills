---
name: code-review
description: Perform a high-signal code review of local changes or a pull request. Flags only bugs, security issues, and clear CLAUDE.md violations - no style nitpicks. Works locally (git diff) or in CI (gh pr diff). The skill produces the review text; routing it (comment, stdout, file) is the caller's responsibility.
argument-hint: "[target]"
---

# Code Review

## Overview

Produce a high-signal review of a set of code changes. The skill identifies the diff to review (local working tree, a branch against its base, or a GitHub pull request), inspects it against the repository's CLAUDE.md rules, and reports only validated issues -- bugs that will fail, logic errors, real security problems, and unambiguous CLAUDE.md violations. Use this skill locally before pushing, or wire it into CI as part of a larger workflow.

## Arguments

### Definitions

- **`[target]`** (optional): What to review. Accepts one of:
  - Omitted -- review local changes (staged + unstaged vs HEAD; if the working tree is clean, review the current branch against its merge-base with the default branch)
  - `staged` -- review only staged changes
  - `unstaged` -- review only unstaged working-tree changes
  - `<ref>` -- review commits reachable from HEAD but not from `<ref>` (e.g., `main`, `origin/main`)
  - `<base>..<head>` -- review the diff between two refs
  - `PR <number>` or `#<number>` -- review a GitHub pull request via `gh`

### Values

Arguments: $ARGUMENTS

## Core Principles

- Review only the diff. Do not flag pre-existing issues outside the changed lines.
- High signal only. If you are not confident an issue is real, discard it.
- The skill outputs the review as text. It does not decide where the output goes (stdout, PR comment, file, CI annotation) -- the caller handles routing.
- Never mutate the repository. No commits, no pushes, no inline-comment API calls from within the skill. Any write-side effects are the caller's responsibility.
- Do not list positives, summaries of what the PR does well, or general observations. Surface issues only.
- Do not launch subagents.

## Skill-Specific Guidelines

### What to flag

Flag only when at least one of these is true:

- Code will fail to compile/parse (syntax errors, type errors, missing imports, unresolved references)
- Code will definitely produce wrong results regardless of inputs (clear logic errors)
- Real security issues introduced by the diff (injection, auth bypass, secret exposure, unsafe deserialization, etc.)
- Clear, unambiguous CLAUDE.md violations where you can quote the exact rule. Only consider CLAUDE.md files whose directory is an ancestor of the reviewed file.

### What to never flag

- Pre-existing issues outside the diff
- Things that look like bugs but are actually correct on closer reading
- Style/quality concerns, subjective suggestions, pedantic nitpicks
- Input-dependent potential issues where the bad input may never occur
- Issues a linter or type checker would catch
- Issues already silenced in code (lint-ignore comments, type-ignore, etc.)
- Missing tests or test coverage unless CLAUDE.md explicitly requires them

### Severity rating

Rate each validated issue with a colored circle emoji:

- 🔴 critical -- will break production or expose a vulnerability
- 🟠 high -- clearly incorrect behavior users will hit
- 🟡 medium -- incorrect behavior in realistic edge cases
- 🟢 low -- minor correctness or clear CLAUDE.md violation with low blast radius

Use ✅ to mark checks that passed cleanly (e.g., "✅ No CLAUDE.md violations") and ❌ to mark the top-line verdict when one or more issues were found. Skip the checkmarks entirely if they would clutter the output -- they are meant to give the caller a quick visual summary, not to pad the review.

### Resolving the target

1. If `$ARGUMENTS` starts with `PR` or `#`, extract the PR number and use `gh pr view <n>` plus `gh pr diff <n>` to get the title, description, and diff. Requires `gh` to be authenticated.
2. If `$ARGUMENTS` contains `..`, treat it as `<base>..<head>` and use `git diff <base>..<head>`.
3. If `$ARGUMENTS` is a single ref that resolves (`git rev-parse --verify`), use `git diff <ref>...HEAD` (three-dot: diff from the merge-base).
4. If `$ARGUMENTS` is `staged`, use `git diff --staged`.
5. If `$ARGUMENTS` is `unstaged`, use `git diff`.
6. If `$ARGUMENTS` is empty:
   - If `git status --porcelain` is non-empty, review `git diff HEAD` (staged + unstaged combined).
   - Otherwise, determine the default branch (`git symbolic-ref refs/remotes/origin/HEAD` or fall back to `main`/`master`) and review `git diff <default>...HEAD`.

If the resolved diff is empty, report that there is nothing to review and stop.

## Instructions

1. Resolve the target per the rules in "Resolving the target" above and obtain the diff plus the list of changed files.
2. Read the repository root `CLAUDE.md` if it exists. Then read any `CLAUDE.md` located in a directory that is an ancestor of a changed file. Do not read other files unless needed to validate a specific suspected issue.
3. Walk the diff and collect candidate issues. For each candidate, ask: "Am I confident this is a real problem introduced by this diff?" If no, drop it.
4. For each surviving issue, assign a severity and write one concise finding that:
   - Begins with the severity emoji (🔴 / 🟠 / 🟡 / 🟢)
   - Names the file and line range (e.g., `path/to/file.ts:42-47`)
   - Describes the issue itself -- no praise, no general observations
   - Cites the CLAUDE.md rule verbatim when the issue is a CLAUDE.md violation
   - Suggests a fix. Include a code block with the corrected snippet only when the fix is small (under ~6 lines) and self-contained at a single location; otherwise describe the fix in prose.
5. If there are zero validated issues, emit the "no issues" output below and stop.
6. Emit the findings in severity order (CRITICAL first). Do not emit a trailing summary.

## Output Guidance

Emit plain markdown. The caller decides where it goes (terminal, PR comment body, file on disk, CI log).

When no issues are found, emit exactly:

```markdown
## Code review

✅ No issues found. Checked for bugs and CLAUDE.md compliance.
```

When issues are found, emit:

````markdown
## Code review

❌ Found N issue(s).

- 🔴 `path/to/file:line-range` -- one-sentence description of the issue.
  Optional extra sentence of context or the CLAUDE.md rule being violated.

  ```suggestion
  // small self-contained fix, if applicable
  ```

- 🟡 `path/to/other/file:line-range` -- ...
````

Use the emojis 🔴 🟠 🟡 🟢 on each finding to signal severity, ✅ to mark a clean result, and ❌ on the header line when issues exist.

Do not include positives, summaries, or a closing paragraph.
