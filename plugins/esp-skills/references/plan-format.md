# Plan Format

Plan format 1 is the machine-consumable plan that `esp-plan` writes and that `esp-build` and a harness read. A plan is a markdown file with flat YAML frontmatter and a fixed section and milestone layout, so `scripts/plan.mjs` can parse it into JSON without a model.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" parse <run-dir>/plan.md   # plan as JSON
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" lint <run-dir>/plan.md    # plan-lint
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" diff <previous> <next> --run-dir <run-dir>  # amendment check
```

## Files and Versions

- Plans live in the run directory only, never in the repository
- `plan.md` is version 1. Each amendment writes the next version as `plan.v<N>.md` (`plan.v2.md`, `plan.v3.md`, ...) and never edits an earlier file
- The frontmatter `version` must match the file name
- Readers always use the latest version: `runs.mjs plan --run-dir <path>` returns its path

## Frontmatter

| Key           | Required | Value                                                   |
| ------------- | -------- | ------------------------------------------------------- |
| `plan_format` | Yes      | `1`                                                     |
| `title`       | Yes      | Short plan title, also the source of the branch name    |
| `type`        | Yes      | `feature`, `bug` or `chore`                             |
| `version`     | Yes      | Plan version, `1` for `plan.md`, `N` for `plan.v<N>.md` |
| `task`        | No       | The task as the user stated it, in one line             |
| `source`      | No       | Issue URL or document path the task came from           |
| `created`     | No       | Date the version was written (`YYYY-MM-DD`)             |

Values are flat scalars (quote strings that contain `:` or `#`). Other keys are invalid, except `x-` extension keys.

## Sections

Top-level sections are `##` headings, in this order:

1. `## Overview` (required): what the task achieves and why, in a few sentences
2. Context sections (optional, any title): type-specific material such as `## Requirements`, `## Architecture`, `## Root Cause`, `## Current State`. They come after Overview and before Milestones
3. `## Milestones` (required): one `###` block per milestone (see below)
4. `## Risks` (required): a list, or `- None`
5. `## Open Questions` (required): a list, or `- None`. An autonomous build proceeds without answers, so keep only questions the plan could not settle and state the assumption the plan makes
6. `## Out of Scope` (required): a list, or `- None`

HTML comments are ignored. Lists use `-`, `*` or `1.`, and indented lines continue the previous item.

## Milestones

Each milestone is one coherent, reviewable commit. `esp-build` implements one milestone per builder run and produces exactly one commit for it.

```markdown
### M2: Add token refresh

- **Goal**: Expired access tokens are refreshed without logging the user out
- **Complexity**: medium
- **Depends**: M1
- **Files**: `src/auth/refresh.ts`, `src/auth/session.ts`, `tests/auth/refresh.test.ts`

#### Tasks

1. Add `refreshToken()` that calls the provider token endpoint
2. Retry the failed request once after a refresh

#### Acceptance Criteria

- A request with an expired token succeeds after one refresh
- A failed refresh logs the user out

#### Validation

- `pnpm test tests/auth`
```

| Element                    | Rule                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Heading                    | `### M<n>: <title>`. IDs are `M1`, `M2`, ... and unique. An amendment never reuses a removed ID       |
| `**Goal**`                 | One sentence, the outcome of the milestone                                                            |
| `**Complexity**`           | `low`, `medium` or `high`. It selects the builder model from config. Plans never name models          |
| `**Depends**`              | `none`, or a comma-separated list of earlier milestone IDs. Milestones are listed in dependency order |
| `**Files**`                | Comma-separated paths the milestone creates or changes, in backticks                                  |
| `#### Tasks`               | Ordered, actionable steps                                                                             |
| `#### Acceptance Criteria` | Objective checks the verifier can confirm                                                             |
| `#### Validation`          | Commands that prove the milestone, each item starting with the command in backticks                   |

No other `**Field**` or `####` subsection is allowed in a milestone. Plan-lint warns on milestones with more than 12 tasks or 20 files.

## Parsed JSON

`plan.mjs parse` prints:

```json
{
  "plan_format": 1,
  "title": "Add OAuth login",
  "type": "feature",
  "version": 1,
  "task": "Add Google OAuth login",
  "source": null,
  "created": "2026-11-08",
  "overview": "...",
  "context": [{ "title": "Architecture", "body": "..." }],
  "milestones": [
    {
      "id": "M1",
      "title": "Add the OAuth provider",
      "goal": "...",
      "complexity": "medium",
      "depends": [],
      "files": ["src/auth/provider.ts"],
      "tasks": ["..."],
      "acceptance": ["..."],
      "validation": ["pnpm test tests/auth"]
    }
  ],
  "risks": ["..."],
  "open_questions": [],
  "out_of_scope": ["..."]
}
```

`- None` becomes an empty list. Exit codes: `0` valid, `1` invalid plan (errors printed), `2` usage error.

## Amendments

An amendment changes only the remaining milestones:

1. Read the latest version (`runs.mjs plan`) and the completed milestones: the `milestones` entries of `<run-dir>/state.json` with `status: done` (written by `esp-build`), plus any IDs the caller passes
2. Write `plan.v<N+1>.md` with `version: N+1`. Copy every completed milestone block unchanged. Change, add or remove only remaining milestones, and give new milestones new IDs
3. Run `plan.mjs diff <previous> <next> --run-dir <run-dir>`. It fails when a completed milestone changed or disappeared, when the version is not the next one, or when the new plan does not lint. Its `affects` list holds the changed, added and removed IDs
4. Log it with `runs.mjs amend --run-dir <run-dir> --text <amendment> --affects <affects>`, which appends to `amendments.jsonl`, emits `amendment.applied` and logs an operator decision

## Plan-Lint

`plan.mjs lint` checks the frontmatter, the section names and order, every milestone field and subsection, unique IDs, dependencies on earlier milestones only, complexity values, and validation commands. It returns `{ file, valid, version, milestones, errors, warnings }`. Warnings (open questions, large milestones) do not fail the lint.

## Example

```markdown
---
plan_format: 1
title: Add OAuth login
type: feature
version: 1
task: Add Google OAuth login to the web app
created: 2026-11-08
---

# Plan: Add OAuth login

## Overview

Users can sign in with Google. Sessions use the existing session store, so the rest of the app is unchanged.

## Architecture

- A provider module wraps the OAuth flow, following the pattern of `src/auth/password.ts`
- The callback route creates a session through `createSession()`

## Milestones

### M1: Add the OAuth provider

- **Goal**: The app can complete a Google OAuth flow and read the user profile
- **Complexity**: medium
- **Depends**: none
- **Files**: `src/auth/google.ts`, `tests/auth/google.test.ts`

#### Tasks

1. Add `src/auth/google.ts` with `authorizeUrl()` and `exchangeCode()`
2. Add unit tests with a mocked token endpoint

#### Acceptance Criteria

- `exchangeCode()` returns the profile for a valid code
- An invalid code raises `AuthError`

#### Validation

- `pnpm test tests/auth`

### M2: Add the login route

- **Goal**: Users sign in with Google from the login page
- **Complexity**: low
- **Depends**: M1
- **Files**: `src/routes/login.ts`, `src/views/login.html`

#### Tasks

1. Add `/auth/google` and `/auth/google/callback`
2. Add the "Sign in with Google" button

#### Acceptance Criteria

- A successful callback creates a session and redirects to `/`

#### Validation

- `pnpm test`
- `pnpm lint`

## Risks

- The provider rate-limits token exchanges during tests: the tests mock the endpoint

## Open Questions

- None

## Out of Scope

- Other OAuth providers
```
