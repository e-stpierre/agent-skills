# Internal Review

The `review` phase of the orchestrated track: bounded review and fix rounds on the task branch, before anything is pushed. `ship.internal_review_rounds` (`2`) caps the rounds, and `0` skips the phase. `ship.mjs next` returns `phase: review` with `sub` and `loop` (`loop.step` is the step of this round, `loop.findings_path` the findings to fix):

- **`sub: review`** (`reviewer` role): spawn the phase subagent on `skills/review/esp-review/SKILL.md` with `--plan <plan_path> --target origin/<base>`, on the task branch. Its step is `loop.step` (`review-<N>`)
- **`sub: review-fix`** (`fixer` role): spawn the phase subagent on `skills/github/esp-fix-review/SKILL.md` with `--internal --findings <loop.findings_path>`. It commits `fix(review): ...` and never pushes

`ship.mjs review-loop` prints the loop state at any time. When the loop ends, `next` returns `action: complete` (record `phase review --status done`), `halt` (run `ship.mjs halt` with its `key`) or `stop` (run `ship.mjs stop` with its `status`).

In `all` mode, standalone and not headless, before each fix: show the findings by class (`by_class` from the review result, details in `findings_path`), and ask whether to fix as recommended or to choose for the B items. Log the answers as operator decisions and pass them to the fixer.
