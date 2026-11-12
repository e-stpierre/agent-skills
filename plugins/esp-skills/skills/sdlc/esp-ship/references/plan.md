# Plan Phase

The orchestrated track always ends its plan phase with a plan file in plan format 1, because the milestone loop builds from it. `ship.mjs next` returns `phase: plan` with `plan_source` and `latest_plan` (the latest plan version in the run directory, or `null`).

## By Plan Source

- **`reuse`**: no model. With a plan file from the request, record `phase plan --status done --plan <path>`. With a plan already in the run directory, record `phase plan --status done` (it takes `latest_plan`)
- **`import`**: spawn the `planner` phase subagent with `model: sonnet` (not the model from `next`) on `skills/sdlc/esp-plan/SKILL.md` with `--import <path> --interactive off`, where `<path>` is the triage `path`. Then record `phase plan --status done --plan <outputs.plan_path>`
- **`synthesize`**: no model. Run `plan.mjs synthesize --run-dir <run-dir> --title <title> --goal <goal> --validation <command>` (repeat `--validation` for each gate, `--files <a,b>` when known), then record `phase plan --status done`
- **`generate`**: spawn the `planner` phase subagent (see Phase Subagents in SKILL.md) on `skills/sdlc/esp-plan/SKILL.md` with `--interactive off <request>`. With `escalated_from` in `ship.json`, add the escalation reason and the `escalation.patch` path (when there is one) as extra context: the plan may reuse that work. Then record `phase plan --status done --plan <outputs.plan_path>`

## After the Plan

- `phase plan --status done` checks the milestone budget. `milestones.action: halt` runs `ship.mjs halt --key budget`
- In `plan` or `all` mode, standalone and not headless: show the title, the milestones, the risks and the open questions, and ask for approval. Feedback runs `esp-plan --amend --interactive off "<feedback>"` in a new planner subagent, then the check again
- A planner that returns `awaiting-human` follows Waiting and Open Items in SKILL.md

## Amending

An operator message that changes the plan, or feedback at the checkpoint, goes through `esp-plan --amend`: it keeps the completed milestones unchanged. Then run `ship.mjs milestone init` again before the next milestone: it syncs `state.json` with the amended plan and keeps the done milestones.
