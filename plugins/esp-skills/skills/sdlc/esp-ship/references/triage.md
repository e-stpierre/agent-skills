# Triage

Triage runs once, on a new run, before `ship.mjs init`. It reads the request, the flags and the repository, and decides two things: the track and the plan source. Each choice is logged with `runs.mjs decision` (`phase: triage`), with `source: operator` when a flag forced it, `policy` when a config rule or a script decided, and `agent` when you judged it.

## Read the Request

- **GitHub issue** (a URL or `#<number>`): `gh issue view <n> --json title,body,labels`
- **Path to a file**: read it. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" lint <path>`: `valid: true` means the file is a plan in plan format 1
- **Anything else**: the text is the request

## Pick the Plan Source

- **A valid plan file**: `reuse`. The orchestrated track builds it as is, without a planning model
- **A plan already in the run directory** (`runs.mjs plan --run-dir <run-dir>` finds one): `reuse`
- **Anything else on the orchestrated track**: `generate`, so `esp-plan` writes the plan

## Pick the Track

1. `--track` given: use it (`source: operator`). A plan source of `reuse` always means `orchestrated`: a `--track inline` with a plan file is a usage error.
2. A plan file: `orchestrated` (`source: policy`).
3. Otherwise, judge the request (`source: agent`). Choose `inline` when all hold:
   - the request is clear: one concern, no open design choice that changes scope, a public API or the data model
   - your estimate of the changed files, tests included, is within `ship.inline.max_files_changed` (`10`)
   - it needs no milestone ordering: one commit is a reviewable change

   Otherwise choose `orchestrated`. Log the decision with the file estimate and the reason in one line, for example `Inline track: 3 files (src/status.ts, test/status.test.ts, README.md), one concern`.

An inline task that grows past the limit later is not a triage error: the inline track moves to the orchestrated track in place (see inline.md).

## Hand Off

Pass the result to `ship.mjs init`: `--track <track>` and, on the orchestrated track, `--plan-source <source>`. With a plan file, the plan phase records it without a model (see plan.md).
