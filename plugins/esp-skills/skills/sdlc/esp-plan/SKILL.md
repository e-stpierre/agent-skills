---
name: esp-plan
description: Implementation plan as parseable milestones in a run directory. Use to plan a feature, bug fix or chore before building it, or to amend the remaining milestones of an existing plan.
argument-hint: "[-a|--amend] [-I|--import <path>] [-t|--type <type>] [-i|--interactive <mode>] [-d|--run-dir <path>] [-c|--config-snapshot <path>] [context]"
metadata: { af-contract: 1, af-level: steerable }
---

# ESP Plan

## Overview

Explore the codebase and write an implementation plan that `esp-ship` and a harness can parse: milestones with IDs, goals, complexity, dependencies, files, tasks, acceptance criteria and validation commands. Use it to plan a feature, bug fix or chore before building it, with `--import` to convert a task list or a design document without exploring, or with `--amend` to change the remaining milestones of an existing plan without touching completed ones. The plan is written to a run directory, never to the repository, and the skill ends with a contract result block.

## Arguments

### Definitions

- **`[-a|--amend]`** (optional): Amend the latest plan in the run directory instead of writing a new one. `[context]` is then the amendment, as text or a file path. Requires `--run-dir`.
- **`[-I|--import <path>]`** (optional): Convert a task list (a checkbox progress list plus one heading per package) or a design document into a plan, with no codebase exploration: one milestone per unchecked package, checked packages listed in `## Out of Scope`, the source path in the `source` frontmatter key. Cannot be combined with `--amend`.
- **`[-t|--type <type>]`** (optional): Plan type: `feature`, `bug`, `chore` or `auto`. Defaults to `plan.default_type` (`auto`).
- **`[-i|--interactive <mode>]`** (optional): When to stop and ask: `off` (never), `plan` or `all` (ask for open choices and approve the plan before finishing). Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. Without it, the skill creates its own run under `runs.root`.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every `config.mjs` and `runs.mjs` call.
- **`[context]`** (optional): The task: free text, an issue URL, or a document path. With `--amend`, the amendment.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the plan format, the parser and the amendment rules, see [plan-format.md](../../../references/plan-format.md)
- For feature plans, see [references/feature.md](references/feature.md)
- For bug fix plans, see [references/bug.md](references/bug.md)
- For chore plans, see [references/chore.md](references/chore.md)
- For classifying choices and when to ask, see [decision-policy.md](../../../references/decision-policy.md)
- For the explorer model, see [model-selection.md](../../../references/model-selection.md)

## Core Principles

- Explore the codebase before planning, and follow its existing patterns and conventions
- Every milestone is one coherent, reviewable commit that changes code and can be verified by its validation commands
- Write plans to the run directory only, never inside the repository, and never commit them
- A written plan version is final. An amendment writes the next version and keeps completed milestones exactly as they were
- Milestones declare `complexity` and the builder picks the model from config, so plans name no model
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. `run.json`, `decisions.jsonl` and result files are written by `runs.mjs` only
- A plan is done only when plan-lint passes
- Plans carry no time estimates, deadlines or scheduling

## Skill-Specific Guidelines

### Configuration

Read the `plan` section and the shared defaults once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get plan
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                        | Default                            | Effect                                                |
| -------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `plan.default_type`        | `auto`                             | Plan type when `--type` is not given                  |
| `plan.explore_agents`      | `feature: 3`, `bug: 2`, `chore: 2` | Explore subagents per plan type (`0` explores inline) |
| `defaults.interactive`     | `off`                              | Interactive mode when `--interactive` is not given    |
| `defaults.models.explorer` | `sonnet`                           | Model and effort passed to each Explore subagent      |
| `defaults.language`        | `en-US`                            | Language of the plan prose                            |

### Run Directory and Contract

esp-plan is a steerable skill: it writes a result block, reads operator messages, and asks through `needs_input` under a harness. The table abbreviates `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs"` as `runs.mjs` (same for `plan.mjs`). Every `runs.mjs` call except `create` takes `--run-dir <path>`, and every `runs.mjs` call takes `--config-snapshot <path>` when given:

| Moment                   | Command                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Own run (no `--run-dir`) | `runs.mjs create <slug> --title <title> --workflow esp-plan --repo <repo-root>` (prints `run_dir`) |
| Pending messages         | `runs.mjs messages`, then `runs.mjs deliver <id>...` once applied                                  |
| Latest plan              | `runs.mjs plan` (`{ path, version }`, version 0 when there is none)                                |
| Lint                     | `plan.mjs lint <plan-file>`                                                                        |
| Import draft             | `plan.mjs import <path> --run-dir <path> [--type <type>]` writes `plan.md` and prints its lint     |
| Parallel batches         | `plan.mjs batches <plan-file>` prints `{ waves, max_batch, parallel, summary }`                    |
| Amendment check          | `plan.mjs diff <previous> <next> --run-dir <path>`                                                 |
| Amendment log            | `runs.mjs amend --text <amendment> --affects <ids> --from user`                                    |
| Decision                 | `runs.mjs decision --json '<decision>'` (see the decision policy for fields and `x-esp-class`)     |
| Result block             | `runs.mjs result <step> --json '<block>'` prints the final output line                             |
| Own run finished         | `runs.mjs update --status done`, or `halted` or `awaiting-human` to match the result               |

The step name is `plan` for a new plan and `plan-v<N>` for an amendment that writes version N.

### Parallel Milestones

`esp-ship` builds milestones that do not depend on each other and touch disjoint files at the same time, in separate worktrees. Shape the milestones so the most work can run in parallel:

- **Depends**: declare a dependency only when the milestone really needs the other one's code. Order alone is not a dependency
- **Files**: list every file the milestone creates or changes, so the list is exhaustive. Keep the lists of milestones that could run at the same time disjoint, and avoid `.` (the whole repository): such a milestone always runs alone
- **Shared scaffolding**: move what several milestones need (a shared type, a config entry, a registry line) into its own early milestone, so the later ones fan out from it instead of touching the same file
- **Batches**: `plan.mjs batches <plan-file>` prints the dependency waves, each split into batches of milestones with disjoint files. Plan-lint warns on two independent milestones that share a file and on a milestone whose files cover the whole repository

### Operator Messages

Treat an `## Operator Messages` section in the prompt, and every pending message from `runs.mjs messages`, as instructions from the user that override the original task where they conflict. Deliver inbox messages you applied with `runs.mjs deliver`; the harness marks injected messages itself.

### Asking and Deciding

Classify every open choice with the decision policy:

- **A-Fix and B-Decide**: pick the recommended option, record it in the plan (Architecture, Fix Strategy or Scope), and log it as a decision with `phase: plan`
- **B-Scope or Halt** (ambiguity that changes scope or public API): in `plan` or `all` mode, ask. With `--run-dir` and no user, write the plan with the safest assumption stated in `## Open Questions`, then end with `status: awaiting-human` and a blocking `needs_input`. Standalone with `off`, state the assumption in `## Open Questions` and log it

## Instructions

1. **Parse arguments**: read each option by its short or long name (`-a` or `--amend`, `-t` or `--type`, and so on; `--type=<value>` works too) and `[context]`. Fail with a usage message if `--amend` is given without `--run-dir`, or together with `--import`. When `[context]` is an existing file path, read it; when it is an issue URL, fetch it with `gh issue view` if available.
2. **Load configuration** (see Configuration) and resolve the interactive mode: the option, else `defaults.interactive`. Use `off` in headless sessions.
3. **Resolve the run directory**: use `--run-dir` when given. Otherwise derive a short title from the task and run `runs.mjs create`, and use the printed `run_dir`.
4. **Read operator messages** (see Operator Messages) and apply them before exploring.
5. **Amend mode** (`--amend`): skip to step 12.
6. **Import mode** (`--import <path>`): convert the source without exploring the codebase (no Explore subagent), log the import as a decision (`source: policy`, the source path in the rationale), then continue at step 15.
   - **Task list**: run `plan.mjs import <path> --run-dir <run-dir>`, with `--type` unless it is `auto`. It writes `plan.md` with one milestone per unchecked package in dependency order, maps the package dependencies to milestone IDs, and prints the lint report. Fill only what the report names as missing or empty: `**Files**` from the package tasks, and `#### Validation` from the project manifest scripts (`package.json`, `Makefile`, `pyproject.toml`). Keep each package's goal, tasks and acceptance criteria as written, and add no milestone
   - **Design document** (`plan.mjs import` exits with `Not a task list`): write `plan.md` yourself in the plan format, one milestone per step or section of the document, with `source` set to the path. Fill missing details the same way, and state any assumption in `## Open Questions`
7. **Detect the plan type** when it is `auto`: `feature` for new functionality, `bug` for defects and unexpected behavior, `chore` for refactoring, dependencies and maintenance. Log the detected type as a low-risk decision.
8. **Load the type reference** (`references/<type>.md`) and the plan format ([plan-format.md](../../../references/plan-format.md)).
9. **Explore the codebase**: launch `plan.explore_agents.<type>` Explore subagents in parallel, each with a distinct focus (affected modules, existing patterns and tests, integration points), passing the `explorer` model and effort. With `0`, explore inline. Done when you know every file each milestone will touch, the patterns it follows, and the validation commands (test, lint, build) the project uses.
10. **Gather requirements**: settle the type reference's requirements questions from the context and the exploration. Ask only in `plan` or `all` mode; otherwise follow Asking and Deciding.
11. **Write `plan.md`** in the run directory, following the plan format: frontmatter with `version: 1`, the type-specific context sections, then milestones in dependency order, each one commit with explicit files and validation commands. Continue at step 15.
12. **Read the latest plan and completed milestones**: `runs.mjs plan` gives version N (fail if it is 0). Completed milestones are the `milestones` entries of `<run-dir>/state.json` with `status: done`; when there is no `state.json`, treat none as completed.
13. **Write `plan.v<N+1>.md`** with `version: N+1`: copy the previous version, keep every completed milestone block byte for byte, and change, add or remove only remaining milestones to apply the amendment. New milestones get new IDs; existing IDs keep theirs.
14. **Check and log the amendment**: run `plan.mjs diff <previous> <new> --run-dir <run-dir>` and fix the new file until it passes. Then run `runs.mjs amend --text <amendment> --affects <affects>` with the `affects` list from the diff. It appends to `amendments.jsonl` and logs the operator decision.
15. **Plan-lint**: run `plan.mjs lint` on the written file. Fix every error and lint again until `valid` is true. Resolve each warning, or state in the report why it stays. A shared-file warning is resolved by a real `Depends`, or by moving the shared files to an earlier milestone (see Parallel Milestones).
    - **Parallel batches**: when the plan has two or more milestones, run `plan.mjs batches <plan-file>` (with `--run-dir <run-dir>` for an amendment, so completed milestones are left out) and write its `summary` lines as a list in a `## Parallel Batches` context section, just before `## Milestones` (replace the section of a copied version). Lint again.
16. **Interactive approval** (`plan` or `all`): present the summary and ask for approval before the result block. Apply requested changes to the same file (the version is final only once approved) and lint again.
17. **Write the result block** with `runs.mjs result <step>` and update an own run's status. Use `status: done` (or `awaiting-human` with `needs_input`, see Asking and Deciding), `max_risk` from the plan's risks, and `outputs` with `plan_path`, `plan_version`, `plan_type`, `milestones` (IDs) and `milestones_remaining` (IDs not completed). For an import, add `source` (the path) and `imported` (package ID to milestone ID). For an amendment, add `amendment` (the `A00n` ID) and `affects`.
18. **Report** the summary (see Output Guidance), then end with the line printed by `runs.mjs result` as the final output line.

## Output Guidance

A short summary, then the result block as the final line:

```text
Plan written to <run-dir>/plan.md (version 1, feature)

## Add OAuth login
- M1: Add the OAuth provider (medium)
- M2: Add the login route (low, depends on M1)

Decisions: 2 logged (type detected as feature; session store reused)
Open questions: none
Plan-lint: passed

Next: /esp-skills:esp-ship --run-dir <run-dir>
{"contract_version":1,"status":"done","summary":"Planned Add OAuth login in 2 milestones.","outputs":{"plan_path":"...","plan_version":1,"plan_type":"feature","milestones":["M1","M2"],"milestones_remaining":["M1","M2"]}}
```

For an amendment, list the changed, added and removed milestones and the amendment ID instead of the full milestone list.
