# Triage

Triage runs once, on a new run, after the run directory exists and before `ship.mjs init`. It reads the request, the flags and the repository, and decides the plan source and the track, or ends the run when there is nothing to do. `ship.mjs triage` does the detection and every rule-based choice. You add only the track judgment for a prompt or an issue.

`triage` -> `[judge the track]` -> `triage --record` -> `init`, or the result when `nothing_to_do`

## Detect

Run `ship.mjs triage --request <context> --run-dir <run-dir> --project-dir <repo-root>`, with `--track <track>` when the flag was given and `--config-snapshot <path>` when given. It prints the facts and the choices it could make, with no writes:

- **`input_kind`**: `plan` (the file passes plan-lint), `task-list` (a checkbox progress list whose items name package headings, such as `- [ ] FRC-02: Health probe` and `#### FRC-02: Health probe`), `document` (any other file; `plan_errors` lists the lint errors of a broken plan), `issue` (`#12`, `owner/repo#12` or an issues URL), or `prompt`
- **`packages`**: for a task list, each package's `id`, `title` and `checked` state
- **`plan_source`**: `reuse` (a plan file, or a plan already in the run directory), `import` (an open task list or a document), `generate` (a prompt or an issue on the orchestrated track), or `none` (the inline track)
- **`track`** and **`track_source`**: `operator` from `--track`, `policy` from a rule, `agent` from your judgment
- **`nothing_to_do`**: `true` when every package of a task list is checked
- **`needs_judgment`**: `true` for a prompt or an issue without `--track`: judge the track (below)

A plan file with `--track inline` is a usage error (exit 2): a plan always runs on the orchestrated track.

## Judge the Track

Only when `needs_judgment` is `true`. For an issue, read it first: `gh issue view <n> --json title,body,labels`. Choose `inline` when all hold:

- the request is clear: one concern, no open design choice that changes scope, a public API or the data model
- your estimate of the changed files, tests included, is within `max_files_changed` from the triage output (`ship.inline.max_files_changed`, `10`)
- it needs no milestone ordering: one commit is a reviewable change

Otherwise choose `orchestrated`. Pass the judgment back as `--judged-track <track> --estimate <files> --reason <one line>`, for example `--judged-track inline --estimate 3 --reason "src/status.ts, test/status.test.ts, README.md: one concern"`. The script refuses `inline` with an estimate over the limit.

An inline task that grows past the limit later is not a triage error: the inline track moves to the orchestrated track in place (see inline.md).

## Record

Run the same command with `--record` (and the judgment flags when you judged). It logs one decision per choice (`phase: triage`), writes the `triage` step result and prints `{ recorded, result, step, line }`. A second `--record` on the same run prints the recorded result and logs nothing.

## Hand Off

- **`nothing_to_do`**: the run ends here, with no branch and no plan. The triage result (`status: done`) is the final result: skip `init` and the loop, then write the summary, set the run status and report as in Instructions steps 10 and 11, with the `line` printed by `--record` as the final output line
- **Otherwise**: pass the result to `ship.mjs init`: `--track <track>` and, on the orchestrated track, `--plan-source <plan_source>`. The plan phase then follows plan.md: `reuse` records the plan file (`plan_path`) without a model, and `import` converts the task list or the document with `esp-plan --import <path>`
