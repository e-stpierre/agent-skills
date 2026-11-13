# Model Selection

How a skill picks the model and effort of every subagent it spawns. This is the only place the precedence is defined: agents and skills link here instead of repeating it.

## Roles

Each spawn site names a role. The role selects a key under `defaults.models` in the config (`node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults.models`).

| Role         | Spawned by                                              | Agent                     | Default                  |
| ------------ | ------------------------------------------------------- | ------------------------- | ------------------------ |
| `planner`    | `esp-plan`, `esp-go`                                    | none (plan phase)         | `opus`, effort `high`    |
| `explorer`   | `esp-plan`                                              | `Explore`                 | `sonnet`                 |
| `builder`    | `esp-build`, `esp-go`                                   | `esp-skills:esp-builder`  | per milestone complexity |
| `verifier`   | `esp-build`, `esp-go` (build phase)                     | `esp-skills:esp-verifier` | `sonnet`                 |
| `reviewer`   | `esp-review`, `esp-go`                                  | `esp-skills:esp-reviewer` | `opus`, effort `high`    |
| `fixer`      | `esp-fix-review`, `esp-go`                              | `esp-skills:esp-builder`  | `opus`                   |
| `mechanical` | any skill, for rote work; `esp-go` branch and PR phases | any                       | `haiku`                  |

`esp-go` spawns each phase as a `general-purpose` subagent that follows the phase skill, with the model of the phase role from `go.mjs next`: plan `planner`, branch and PR `mechanical`, build `verifier` (the build subagent only runs the milestone loop; its builders get the `builder` models), review `reviewer`, internal and PR fixes and the merge `fixer`. The review wait runs in the orchestrator.

`builder` has one entry per plan milestone complexity: `low` (`sonnet`), `medium` (`opus`), `high` (`opus`, effort `high`).

## Precedence

The first level that gives a value wins:

`--model flag` -> `plan milestone complexity` -> `config role` -> `agent frontmatter` -> `inherit`

1. **`--model` flag**: the user passed `--model <alias>` to the orchestrator skill. It applies to every spawn of the roles that skill documents.
2. **Plan milestone complexity**: for the `builder` role only, the milestone's `complexity` (`low`, `medium`, `high`) selects `defaults.models.builder.<complexity>`. A milestone without `complexity` uses `medium`. Plans never name models.
3. **Config role**: `defaults.models.<role>` from the merged config (defaults, user, project, snapshot).
4. **Agent frontmatter**: the `model` in the agent file. It is a static fallback, used only when the config has no entry for the role.
5. **Inherit**: no model parameter at all; the subagent uses the session model.

Effort follows the same order, but only a level that sets `effort` counts: `--effort` flag (where a skill offers it), then the config entry the model came from. When no level sets it, pass no effort and let the runtime default apply.

**Builder reuse**: the precedence still picks the builder model of every milestone, even when the esp-ship milestone loop continues an earlier builder instead of spawning a new one. A continued agent keeps its model and effort, so `ship.mjs milestone reuse <id>` continues a builder only when the resolved builder model and effort of the next milestone equal the builder's. Any difference, including one caused by complexity (a `low` milestone after a `medium` one), starts a fresh builder with the resolved model. A `--model` flag gives every builder the same model, which makes reuse more likely. Verifiers are never reused. The budget and relevance rules are in the esp-ship milestones reference.

## Rules

- The Agent tool accepts aliases only: `opus`, `sonnet`, `haiku`, `fable`. Agent frontmatter also accepts `inherit`. Never pass a full model ID.
- Pass the resolved values on each spawn, as the Agent tool's `model` and `effort` parameters. Do not rely on the frontmatter.
- Worker skills invoked directly by a user (not spawned) run on the session model. A skill cannot switch the main session model.
- Under a harness, the step's own model is set by the harness (for example `claude -p --model`). The precedence above still applies to the subagents the step spawns, read from the `--config-snapshot`.
- Record what was used: `runs.mjs update --run-dir <path> --model <role>=<alias>[:<effort>]` keeps `run.json` `models` accurate for `esp-recap`.

## Example

A plan milestone `M2` declares `complexity: high`, no `--model` flag was given, and the user config sets `defaults.models.builder.high` to `{ "model": "opus", "effort": "max" }`:

- Builder for M2: `model: opus`, `effort: max` (level 2 selects the `high` entry, level 3 supplies it)
- Verifier for M2: `model: sonnet`, no effort (level 3, defaults)
