# Internal Review

The `review` phase of the orchestrated track: bounded review and fix rounds on the task branch, before anything is pushed. `ship.internal_review_rounds` (`2`) caps the rounds, and `0` skips the phase.

## Review Modes

`--review` (config `ship.review_mode`, default `auto`) picks the reviews of the run. `ship.mjs init --review-mode <mode>` resolves the phases, and a dropped phase is `skipped` in `ship.json` with its reason in `skipped_phases` (`--review pr` for a flag, `ship.review_mode pr` for the config):

- **`auto`**: the pull request review rounds run, and the review gate decides the internal review after the build
- **`internal`**: the internal review only. The `fix-review` phase is skipped: no bot review rounds
- **`pr`**: the bot review only. The `review` phase is skipped. `ship.internal_review_rounds: 0` acts the same way in every mode
- **`both`**: both reviews, with no gate
- **`none`**: no review. The merge still needs green checks (see pr-tail.md)

The inline track has no internal review, so only the `fix-review` part of a mode applies to it.

## Review Gate

With `auto`, `ship.mjs next` returns `action: review-gate` once the build and the final gates are done. Run `ship.mjs review-gate`, then `next` again. The gate reads the real diff (`base_sha..HEAD` in the task tree), the milestone complexities of the plan and the run's `max_risk`, and skips the internal review only when every rule holds:

- the diff has at most `ship.auto.review_max_files` (`3`) files and `ship.auto.review_max_lines` (`150`) added plus deleted lines
- every milestone is `low`
- `max_risk` is `low` (an unknown risk counts as not low)
- no changed path matches `ship.review.always_paths` (auth, security, migrations and CI config by default)

It logs one `policy` decision (`Skip the internal review` or `Run the internal review`) with the numbers in `x-esp-review-gate`, and records `review_gate` in `ship.json`. A skip marks the `review` phase `skipped` with the reason `review gate: ...`. A later call prints the recorded gate and logs nothing.

## Review Loop

`ship.mjs next` returns `phase: review` with `sub` and `loop` (`loop.step` is the step of this round, `loop.findings_path` the findings to fix):

- **`sub: review`** (`reviewer` role): spawn the phase subagent on `skills/review/esp-review/SKILL.md` with `--plan <plan_path> --target origin/<base>`, on the task branch. Its step is `loop.step` (`review-<N>`)
- **`sub: review-fix`** (`fixer` role): spawn the phase subagent on `skills/github/esp-fix-review/SKILL.md` with `--internal --findings <loop.findings_path>`. It commits `fix(review): ...` and never pushes

`ship.mjs review-loop` prints the loop state at any time. When the loop ends, `next` returns `action: complete` (record `phase review --status done`), `halt` (run `ship.mjs halt` with its `key`) or `stop` (run `ship.mjs stop` with its `status`).

In `all` mode, standalone and not headless, run the before-fix checkpoint (see Interactive Checkpoints in SKILL.md) before each fix, and pass the answers to the fixer.

## In the Summary

The result block carries `outputs.skipped_phases`, `outputs.review_mode` and `outputs.review_gate`. `summary.md` names each skipped review phase with its reason.
