# Inline Track

The inline track runs in this session: no subagent, no plan file, exactly one implementation commit. Its phases are `context`, `branch` and `implement`, then the shared tail (see pr-tail.md).

## Phase Boundaries

Before each inline phase:

- `ship.mjs budget`: `action: halt` runs `ship.mjs halt --key budget`
- Operator messages (see SKILL.md). A message that widens the task is a `design` escalation

## Context

1. `phase context --status started`.
2. Read the request (`gh issue view` for an issue, the file for a path), `AGENTS.md` or `CLAUDE.md`, and the code the change touches.
3. Decide the approach and list every file to change, tests included. Run `ship.mjs scope --estimate <n>`. On `action: escalate`, escalate (`files`). A design decision escalates too (`design`, see Escalation). Small choices are B-Decide: apply the recommended option and log it.
4. In `plan` or `all` mode, show the approach and the files, and continue on approval.
5. `phase context --status done --summary "<1-2 sentences: what changes and why>"`.

## Implement

1. `phase implement --status started`. Make the change and its tests.
2. While implementing, run only the checks that cover the change (its tests, plus `ship.gates.always`). Then resolve the gates once and run the full gates before the commit (see gates.md). When a gate fails, run `ship.mjs gate-failure --reason "<gate>: <first error>"`: on `retry`, fix and run the gates again. On `escalate`, escalate (`gates`). On `halt`, `ship.mjs halt --key gates-exhausted`.
3. When every gate passes, run `ship.mjs scope`. On `action: escalate`, escalate (`files`).
4. Make exactly one commit with `esp-commit` (it reads `commit.style`). Invoke the skill when the runtime has a skill tool, otherwise follow its `SKILL.md`.
5. `phase implement --status done --commit <sha> --gates '{"test":"pass",...}'`.

## Escalation

Escalate (when `ship.inline.escalate` is on) on one of these triggers:

- **`files`**: `scope` returns `action: escalate`, from the estimate or after the gates pass
- **`design`**: the request needs a choice that changes scope, a public API or the data model, or several designs are defensible and the choice matters beyond this change (a B-Scope item, or a B-Decide item with lasting consequences)
- **`gates`**: `gate-failure` returns `action: escalate`, the gates failed twice

`scope` and `gate-failure` return `escalate_with`, which says how:

1. In `plan` or `all` mode, standalone and not headless: ask first, with "switch to the orchestrated track" recommended and "continue inline" as the alternative (for `design`, offer the design options too). Log the answer with `runs.mjs decision` (`source: operator`). On "continue", go on, and treat the same trigger as answered for the rest of the task.
2. **`switch-track`** (a run this skill owns): `ship.mjs switch-track --to orchestrated --trigger <t> --reason <text>`. The branch and the uncommitted work stay where they are, and the shared phases keep their progress. Then go back to the loop: `next` returns the plan phase, and the planner gets the reason as context.
3. **`escalate`** (a caller-owned run): `ship.mjs escalate --trigger <t> --reason <text>` (`--question <text>` for `design`). It saves `<run-dir>/escalation.patch`, stashes the work (`git stash list` shows `esp-ship escalation <run-id>`), logs the decision and prints the escalate block (exit 30). Pipe it into `runs.mjs result ship` and end the skill: the caller decides, and `esp-ship --resume --run-dir <run-dir>` takes the run over on the orchestrated track.

With `ship.inline.escalate` off: over the file limit, log a low-risk decision and continue (`action: continue-over-limit`). A design decision follows the decision policy (B-Decide applies the recommendation, B-Scope halts with `scope-change` when it is in `ship.halt_on`). A second gate failure halts with `gates-exhausted`.
