---
name: esp-plan
description: Create an implementation plan for a task (feature, bug fix, or chore), or amend one
argument-hint: "[--amend] [--interactive <mode>] [--type <type>] [--run-dir <path>] [--config-snapshot <path>] [context]"
metadata: { af-contract: 1, af-level: steerable }
---

# ESP Plan

## Overview

Explore the codebase and write an implementation plan that `esp-build` and a harness can parse: milestones with IDs, goals, complexity, dependencies, files, tasks, acceptance criteria and validation commands. Use it to plan a feature, bug fix or chore before building it, or with `--amend` to change the remaining milestones of an existing plan without touching completed ones. The plan is written to a run directory, never to the repository, and the skill ends with a contract result block.

## Arguments

### Definitions

- **`[--amend]`** (optional): Amend the latest plan in `--run-dir` instead of writing a new one. `[context]` is then the amendment, as text or a file path. Requires `--run-dir`.
- **`[--interactive <mode>]`** (optional): When to stop and ask: `off` (never), `plan` or `all` (ask for open choices and approve the plan before finishing). `--interactive=<mode>` also works. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[--type <type>]`** (optional): Plan type: `feature`, `bug`, `chore` or `auto`. Defaults to `plan.default_type` (`auto`). A leading bare `feature`, `bug`, `chore` or `auto` word in the arguments is read as the type too.
- **`[--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. Without it, the skill creates its own run under `runs.root`.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every `config.mjs` and `runs.mjs` call.
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
- Write plans to the run directory only. Never write or commit a plan inside the repository
- Never edit a written plan version. An amendment writes the next version and leaves completed milestones exactly as they were
- Plans never name models: milestones declare `complexity` and the builder picks the model from config
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Never write `run.json`, `decisions.jsonl` or result files by hand
- A plan that does not pass plan-lint is not done: fix it and lint again
- No time estimates, deadlines or scheduling

## Skill-Specific Guidelines

### Configuration

Read the `plan` section and the shared defaults once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get plan
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                          | Default                            | Effect                                                  |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `plan.default_type`          | `auto`                             | Plan type when `--type` is not given                    |
| `plan.explore_agents`        | `feature: 3`, `bug: 2`, `chore: 2` | Explore subagents per plan type (`0` explores inline)   |
| `defaults.interactive`       | `off`                              | Interactive mode when `--interactive` is not given      |
| `defaults.models.explorer`   | `sonnet`                           | Model and effort passed to each Explore subagent        |
| `defaults.language`          | `en-US`                            | Language of the plan prose                              |

### Run Directory and Contract

esp-plan is a steerable skill: it writes a result block, reads operator messages, and asks through `needs_input` under a harness. Every call below takes `--run-dir <path>` (and `--config-snapshot <path>` when given):

| Moment                  | Command                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Own run (no `--run-dir`) | `runs.mjs create <slug> --title <title> --workflow esp-plan --repo <repo-root>` (prints `run_dir`)   |
| Pending messages        | `runs.mjs messages`, then `runs.mjs deliver <id>...` once applied                                    |
| Latest plan             | `runs.mjs plan` (`{ path, version }`, version 0 when there is none)                                  |
| Lint                    | `plan.mjs lint <plan-file>`                                                                          |
| Amendment check         | `plan.mjs diff <previous> <next> --run-dir <path>`                                                   |
| Amendment log           | `runs.mjs amend --text <amendment> --affects <ids> --from user`                                      |
| Decision                | `runs.mjs decision --json '<decision>'` (see the decision policy for fields and `x-esp-class`)       |
| Result block            | `runs.mjs result <step> --json '<block>'` prints the final output line                               |
| Own run finished        | `runs.mjs update --status done`, or `halted` or `awaiting-human` to match the result                 |

Scripts live in `"${CLAUDE_PLUGIN_ROOT}/scripts/"`. The step name is `plan` for a new plan and `plan-v<N>` for an amendment that writes version N.

### Operator Messages

Treat an `## Operator Messages` section in the prompt, and every pending message from `runs.mjs messages`, as instructions from the user that override the original task where they conflict. Apply them before exploring. Deliver inbox messages you applied with `runs.mjs deliver`; the harness marks injected messages itself.

### Asking and Deciding

Classify every open choice with the decision policy:

- **A-Fix and B-Decide**: pick the recommended option, record it in the plan (Architecture, Fix Strategy or Scope), and log it as a decision with `phase: plan`
- **B-Scope or Halt** (ambiguity that changes scope or public API): in `plan` or `all` mode, ask. With `--run-dir` and no user, write the plan with the safest assumption stated in `## Open Questions`, then end with `status: awaiting-human` and a blocking `needs_input`. Standalone with `off`, state the assumption in `## Open Questions` and log it
- In `plan` or `all` mode, show the plan summary and ask for approval before the result block. Apply requested changes to the same version: approval happens before the version is final

## Instructions

1. **Parse arguments**: read the flags, the optional leading type word, and `[context]`. Fail with a usage message if `--amend` is given without `--run-dir`. When `[context]` is an existing file path, read it; when it is an issue URL, fetch it with `gh issue view` if available.
2. **Load configuration** (see Configuration) and resolve the interactive mode: the flag, else `defaults.interactive`. Use `off` in headless sessions.
3. **Resolve the run directory**: use `--run-dir` when given. Otherwise derive a short title from the task and run `runs.mjs create`, and use the printed `run_dir`.
4. **Read operator messages** (see Operator Messages).
5. **Amend mode** (`--amend`): skip to step 11.
6. **Detect the plan type** when it is `auto`: `feature` for new functionality, `bug` for defects and unexpected behavior, `chore` for refactoring, dependencies and maintenance. Log the detected type as a low-risk decision.
7. **Load the type reference** (`references/<type>.md`) and the plan format (`references/plan-format.md` at the plugin root).
8. **Explore the codebase**: launch `plan.explore_agents.<type>` Explore subagents in parallel, each with a distinct focus (affected modules, existing patterns and tests, integration points), passing the `explorer` model and effort. With `0`, explore inline. Find the validation commands (test, lint, build) the project uses.
9. **Gather requirements**: infer them from the context and the exploration. Ask only in `plan` or `all` mode; otherwise follow Asking and Deciding.
10. **Write `plan.md`** in the run directory, following the plan format: frontmatter with `version: 1`, the type-specific context sections, then milestones in dependency order, each one commit with explicit files and validation commands. Continue at step 14.
11. **Read the latest plan and completed milestones**: `runs.mjs plan` gives version N (fail if it is 0). Completed milestones are the `milestones` entries of `<run-dir>/state.json` with `status: done`; when there is no `state.json`, treat none as completed.
12. **Write `plan.v<N+1>.md`** with `version: N+1`: copy the previous version, keep every completed milestone block byte for byte, and change, add or remove only remaining milestones to apply the amendment. New milestones get new IDs. Never renumber.
13. **Check and log the amendment**: run `plan.mjs diff <previous> <new> --run-dir <run-dir>` and fix the new file until it passes. Then run `runs.mjs amend --text <amendment> --affects <affects>` with the `affects` list from the diff. It appends to `amendments.jsonl` and logs the operator decision.
14. **Plan-lint**: run `plan.mjs lint` on the written file. Fix every error and lint again until `valid` is true. Review warnings and resolve them where reasonable.
15. **Interactive approval** (`plan` or `all`): present the summary and ask for approval. Apply changes to the same file and lint again.
16. **Write the result block** with `runs.mjs result <step>` and update an own run's status. Use `status: done` (or `awaiting-human` with `needs_input`, see Asking and Deciding), `max_risk` from the plan's risks, and `outputs` with `plan_path`, `plan_version`, `plan_type`, `milestones` (IDs) and `milestones_remaining` (IDs not completed). For an amendment, add `amendment` (the `A00n` ID) and `affects`.
17. **Report** the summary (see Output Guidance), then end with the line printed by `runs.mjs result` as the final output line.

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

Next: /esp-skills:esp-build <run-dir>/plan.md
{"contract_version":1,"status":"done","summary":"Planned Add OAuth login in 2 milestones.","outputs":{"plan_path":"...","plan_version":1,"plan_type":"feature","milestones":["M1","M2"],"milestones_remaining":["M1","M2"]}}
```

For an amendment, list the changed, added and removed milestones and the amendment ID instead of the full milestone list.
