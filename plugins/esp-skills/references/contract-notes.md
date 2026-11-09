# Harness Contract Notes

How esp-skills implements harness contract v1. agentic-forge owns the contract: the spec is its `docs/harness-contract.md`, and the JSON Schemas and fixtures are published in its `schemas/contract-v1/`. [`contract/v1/`](./contract/v1/) is a byte-identical copy of that directory. esp-skills re-syncs the copy from agentic-forge and never changes it on its own.

Skills never write contract files by hand. They call `scripts/runs.mjs`, which validates every artifact against the schemas before writing it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" <command> --run-dir <path> [options]
```

## Contract Artifacts

| Artifact            | Schema                             | File in a run dir                    |
| ------------------- | ---------------------------------- | ------------------------------------ |
| Run metadata        | `run.schema.json`                  | `run.json`                           |
| Step result block   | `result.schema.json`               | `steps/<NN-step>/result.json`        |
| Decision request    | `needs-input.schema.json`          | `needs_input` field of a result      |
| Operator message    | `inbox-message.schema.json`        | `inbox/<timestamp>-<id>.json`        |
| Amendment           | `amendment.schema.json`            | one line of `amendments.jsonl`       |
| Event envelope      | `event.schema.json`                | one line of `events.jsonl`           |
| Decision            | `decision.schema.json`             | one line of `decisions.jsonl`        |
| Summary frontmatter | `summary-frontmatter.schema.json`  | YAML frontmatter of `summary.md`     |
| Shared definitions  | `common.schema.json`               | none (referenced by the others)      |

Schemas use `urn:harness-contract:v1:<artifact>` as `$id` and reference each other by that URN, so they can be copied unchanged into another repository. Each artifact has `fixtures/<artifact>/valid/` and `fixtures/<artifact>/invalid/` examples. Fixtures named `*-by-runs-mjs.json` are golden files: the tests check that `runs.mjs` produces exactly them.

Extension fields are allowed on most artifacts when they start with `x-` (for example `x-esp-class` on a decision). Any other unknown field is invalid. The event envelope accepts no extension fields; event-specific data goes in `data`.

## Requirements and Where They Are Met

| Contract requirement                                              | Met by                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Run directory named `YYYY-MM-DD-<slug>` under the runs root       | `runs.mjs create <slug>` (root: `--root`, else `runs.root`)   |
| Use the run dir passed by a harness or parent run                 | `runs.mjs create --run-dir <path>` (reuses an existing run)   |
| `run.json` with contract fields and status                        | `runs.mjs create`, `runs.mjs update --status ...`             |
| `ended_at` set on terminal statuses                               | `runs.mjs update --status halted\|failed\|canceled\|done\|merged` |
| `max_risk` is the highest recorded risk                           | `runs.mjs decision`, `result` and `update --max-risk` raise it |
| Result block on the final output line and in `steps/<n>/`         | `runs.mjs result <step>`: writes the file, prints one line    |
| Exit codes `0` done, `10` awaiting-human, `20` halted, `30` escalate, `1` failure | `runs.mjs exit-code <status>`                 |
| `needs_input` only with `status: awaiting-human`                  | `result.schema.json`, checked by `runs.mjs result`            |
| `events.jsonl` append-only, `seq` = line number                   | `runs.mjs event <type>` and the events emitted by other commands |
| `decisions.jsonl` appended when the decision is made              | `runs.mjs decision` (fills `id` as `D001`... and `at`)        |
| Operator messages read at step boundaries                         | `runs.mjs messages` (pending), `runs.mjs deliver <id>`        |
| Delivered messages and amendments logged as operator decisions    | `runs.mjs deliver`, `runs.mjs amend`                          |
| Amendments in `amendments.jsonl`, plans as `plan.vN.md`           | `runs.mjs amend`, `runs.mjs plan` (latest version)            |
| Later steps read the latest plan version                          | `runs.mjs plan`                                               |
| Plans parse without a model; amendments keep completed milestones | `plan.mjs parse`, `plan.mjs lint`, `plan.mjs diff` (`references/plan-format.md`) |
| Milestone loop state (`state.json`, reserved name)               | `build.mjs init`, `next`, `start`, `finish` (emits `iteration.*`, `commit.created`) |
| Review result block built from the findings, not by hand          | `review.mjs parse --result` piped into `runs.mjs result review-<N>` (esp-review) |
| Waiting costs no tokens; reviews matched on the head SHA         | `wait-for-review.mjs` in the background (emits `review.received`), piped into `runs.mjs result await-review` (esp-await-review) |
| Every review comment resolution logged; handled comments never reprocessed | `fix-review.mjs record` (decision + `fix-review.json` handled IDs), `fix-review.mjs result` piped into `runs.mjs result fix-review` (esp-fix-review) |
| Merge only under objective conditions; method and reason logged; merges serialized under a harness lock | `merge-ready.mjs check` (conditions), `merge-ready.mjs merge` (holds `AF_MERGE_LOCK`, emits `merge.locked` and `merge.completed`, logs the decision), piped into `runs.mjs result merge` (esp-merge) |
| `summary.md` frontmatter per the schema                           | `references/summary-template.md`, `runs.mjs validate summary.md` |
| Date filtering without file reads, other filters from `run.json`  | `runs.mjs index --since --until --last --repo --status --risk` |
| Any contract file can be checked                                  | `runs.mjs validate <file>`                                    |

`runs.mjs` also writes these events: `run.started` (create), `run.paused`, `run.resumed`, `run.canceled`, `run.halted`, `run.failed`, `run.completed` (update), `step.completed` or `step.failed` and `needs_input` (result), `message.queued` (send), `message.delivered` (deliver), `amendment.applied` (amend).

## Append Protocol

Writers of `events.jsonl`, `decisions.jsonl`, `amendments.jsonl` and `run.json` hold a lock file next to the target (`<file>.lock`, created with exclusive create, removed after the write; a lock older than 30 seconds is stale). Under the lock, the writer reads the line count, builds the entry (`seq` or the next ID), validates it and appends one line. This keeps lines whole and `seq` gap-free when several processes write to the same run. A harness that writes to the same files must follow the same protocol. Inbox messages need no lock: each is its own file. In a jsonl file, `seq` equals the physical line number and blank lines are only allowed at the end; `runs.mjs validate` reports any other blank line.

## Standalone and Harness Runs

- **Standalone**: the top-level skill (for example `esp-go`) runs `runs.mjs create <slug>` and owns the run. It passes `--run-dir` to the skills it calls, which then write steps, decisions and results into the same directory.
- **Harness**: the harness creates the run dir and passes `--run-dir <path>` and `--config-snapshot <path>`. `runs.mjs create --run-dir` finds the existing `run.json` and leaves it alone. Injected operator messages arrive as an `## Operator Messages` section in the prompt; skills treat it like messages from `runs.mjs messages`.
- Skills never assume which of the two they are in.

## Compliance Levels

| Level      | Requirements                                                 |
| ---------- | ------------------------------------------------------------ |
| Plain      | None. Runs as a step, exit code only                         |
| Reporting  | Writes the result block and `run.json` fields                |
| Steerable  | Reporting, plus reads operator messages and emits `needs_input` |
| Recappable | Steerable, plus writes `decisions.jsonl` and `summary.md`    |

Skills declare their level in frontmatter metadata, for example `metadata: { af-contract: 1, af-level: recappable }`.

Target level of each planned skill:

| Skill                                         | Target level | Notes                                                        |
| --------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `esp-go`, `esp-go-light`                      | Recappable   | Own the run: create it, write `summary.md`                   |
| `esp-build`                                   | Recappable   | Decisions per milestone; summary when run on its own         |
| `esp-plan`                                    | Steerable    | Also logs amendments as decisions                            |
| `esp-fix-review`                              | Steerable    | Also logs every comment resolution as a decision             |
| `esp-review`                                  | Reporting    | Produces text; the caller routes it                          |
| `esp-await-review`                            | Reporting    | Wait primitive                                               |
| `esp-merge`                                   | Reporting    | Also logs the merge method and reason as a decision          |
| `esp-recap`                                   | Plain        | Reads runs, writes none                                      |
| `esp-config`, git, helper and style skills    | Plain        | No run dir                                                   |

## References

- [`contract/v1/`](./contract/v1/): schemas and fixtures
- `scripts/runs.mjs --help`: every command and option
- `scripts/build.mjs --help`: the esp-build milestone state (`state.json`)
- `scripts/review.mjs --help`: esp-review target resolution and finding parsing
- `scripts/wait-for-review.mjs --help`: esp-await-review wait, completion matching and exit codes
- `scripts/fix-review.mjs --help`: esp-fix-review items, rounds, resolutions and replies
- `scripts/merge-ready.mjs --help`: esp-merge conditions, method resolution and the `AF_MERGE_LOCK` merge lock
- `scripts/plan.mjs --help` and [`plan-format.md`](./plan-format.md): plan format 1, parsing, lint and amendment checks
- `scripts/lib/contract.mjs`: status vocabulary, exit codes and schema loading for other scripts
