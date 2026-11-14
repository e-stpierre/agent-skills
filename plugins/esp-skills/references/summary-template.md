# Summary Template

The format of `summary.md`, written once per run by the skill that owns the run (`esp-ship`) when the run ends, halts, or escalates. `esp-recap` and the PR body read it. Summaries live in the run dir only and are never committed.

## Writing Rules

- Write it from the run artifacts, not from memory: `run.json`, `plan.md` (latest version from `runs.mjs plan`), `decisions.jsonl`, `steps/*/result.json`, `amendments.jsonl`, and delivered inbox messages (`runs.mjs messages --all`).
- Keep every section. When a section has nothing to report, write `None.` so readers know it was checked.
- Reference decisions by ID (`D003`), milestones by ID (`M2`), amendments by ID (`A001`), and messages by ID (`m001`).
- The summary answers "what happened and what should I look at", not "how the work was done".
- Validate after writing: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" validate <run-dir>/summary.md`.

## Frontmatter

Values are flat scalars (no lists or nested objects), validated by `contract/v1/summary-frontmatter.schema.json`.

| Field               | Required | Value                                                                             |
| ------------------- | -------- | --------------------------------------------------------------------------------- |
| `task`              | Yes      | The run ID (the run directory name)                                               |
| `title`             | Yes      | Task title, quoted                                                                |
| `status`            | Yes      | Final status: a `run.json` status (`done`, `merged`, `halted`, ...) or `escalate` |
| `workflow`          | No       | Skill or workflow that owned the run (`esp-ship`), or `null`                      |
| `pr`                | No       | Pull request URL, or `null`                                                       |
| `max_risk`          | No       | `low`, `medium`, `high`, or `null` (copy from `run.json`)                         |
| `decisions`         | No       | Number of lines in `decisions.jsonl`                                              |
| `critical_findings` | No       | Number of critical findings reported during the run                               |
| `duration_minutes`  | No       | Minutes between `started_at` and `ended_at`, or `null`                            |

## Sections

| Section                          | Content                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Outcome                          | One paragraph: what was delivered, the track (`inline` or `orchestrated`, and a track switch), the workspace (kind, and for a worktree its path and cleanup), final status, PR, and what is left |
| Decisions                        | The decisions worth a reviewer's attention (medium and high risk first), one line each with ID and class                                                                                         |
| Surprises                        | What differed from expectations: unexpected code, flaky gates, wrong assumptions in the plan                                                                                                     |
| Critical Findings                | 🔴 Critical and high-severity findings, how each was resolved or why it is still open                                                                                                            |
| Review Comment Resolution        | Per reviewer: comments fixed, rejected (with reason), deferred; rounds used                                                                                                                      |
| Operator Messages and Amendments | Each delivered message and amendment, and what changed because of it                                                                                                                             |
| Deviations from Plan             | Milestones changed, skipped, split, or added, and each skipped phase (`outputs.skipped_phases`, the review gate), with the reason                                                                |
| Follow-ups Created               | Deferred and discovered items (from `discovered_items`), with type and where they were recorded                                                                                                  |
| Metrics                          | Milestones done, commits, gate retries, final-gates runs and fix rounds, builder reuses, review rounds, duration, models used                                                                    |

## Template

```markdown
---
task: 2026-11-10-add-token-refresh
title: "Add token refresh"
workflow: esp-ship
status: merged
pr: https://github.com/o/r/pull/42
max_risk: medium
decisions: 7
critical_findings: 0
duration_minutes: 96
---

# Add token refresh

## Outcome

Token refresh is implemented on the orchestrated track, on a new branch in the main checkout, and merged in PR #42 (squash). The three plan milestones shipped as three commits, plus one review-fix commit. Nothing is left open.

## Decisions

- D004 (B-Decide, medium): refresh tokens are rotated on every use; the alternative kept them for their full lifetime
- D006 (Reject, low): rejected the bot suggestion to cache tokens in localStorage, it contradicts the security guidelines

## Surprises

- The existing HTTP client retried 401 responses on its own, so M2 removed that retry instead of wrapping it.

## Critical Findings

None.

## Review Comment Resolution

- claude[bot]: 5 comments, 3 fixed, 1 rejected (D006), 1 deferred (follow-up); 2 rounds

## Operator Messages and Amendments

- m001 (user): "Keep the old endpoint for one release" -> A001 amended M3 to keep `/auth/renew` as a deprecated alias

## Deviations from Plan

- M3 kept the deprecated alias (A001).
- No phase was skipped: the review gate ran the internal review (D005: 9 files, 412 lines, M2 is `high`).

## Follow-ups Created

- follow-up: "Remove the deprecated /auth/renew alias" (result block of step 06-fix-review)

## Metrics

- Milestones: 3 of 3, commits: 4, gate retries: 1 (M2 lint), final gates: 1 run, 0 fix rounds, builder reuses: 1 (M3 continued the M2 builder), review rounds: internal 1, PR 2
- Duration: 96 minutes; builder opus, reviewer opus (high), verifier sonnet
```
