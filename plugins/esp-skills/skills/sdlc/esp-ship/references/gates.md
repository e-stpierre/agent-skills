# Gates

The gate commands (`test`, `lint`, `typecheck`, `build`) prove that a change works. Builders, verifiers and fixers run only the checks of their own scope. The full gates run once, in the main tree, before anything is pushed.

## Gate Commands

Resolve them once per run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" milestone gates --run-dir <run-dir> --project-dir <repo-root>
```

It prints `{ gates, sources, scope, commands, fallback, reason }`. Each gate comes from `ship.gates.<name>` (`source: config`). Without a configured command, it comes from the project files (`source: detected`): the `package.json` scripts with the package manager of the lockfile, `pyproject.toml`, `Cargo.toml`, `go.mod` or a `Makefile`. With neither, the gate has no command (`source: none`) and is skipped. With `--run-dir`, it reads the frozen config and the plan of the run.

## Scoped Checks

`ship.gates_scope` (`milestone`) picks what a builder, a verifier or a fixer runs. Ask `milestone gates` for the scope, and pass its `commands` to the subagent as its gate commands:

- **A milestone**: `--milestone <id>` returns the milestone's `#### Validation` commands (`validate-1`, `validate-2`, ...), plus the gates named in `ship.gates.always` (for example `typecheck`)
- **A fix round**: `--files <a,b>` (the files the fix touches) returns the validation commands of the milestones whose `Files` cover them, plus `ship.gates.always`
- **Fallback**: a milestone without validation commands, files that no milestone covers, or a run without a plan gets the full gates (`fallback: true` and the `reason`)
- **`ship.gates_scope: full`**, or `--scope full`: the full gates everywhere

## Final Gates

The `final-gates` phase of the orchestrated track runs after `build` and before `review`, so the internal review and the push only see code that passes every gate. `ship.mjs next` returns `phase: final-gates` with `commands` (the full gates), `runs` and `fix_rounds`. This session runs it, in the main tree (`cwd`):

1. `phase final-gates --status started`.
2. Run every command of `commands`.
3. Record the run with `ship.mjs final-gates --result pass|fail --gates '{"test":"pass","lint":"fail"}' [--reason "<gate>: <first error>"]` and act on `action`:
   - **`continue`**: every gate passes. The phase is done; go on with `ship.mjs next`
   - **`fix`**: spawn one `esp-skills:esp-builder` as the `fixer` role (`role`, `model` and `effort` from the output), with the failing gates and their output, step `final-gates-fix-<round>`, and the commit title `fix(gates): <what changed>`. Then run `ship.mjs next`: it returns `final-gates` again, so the full gates run once more
   - **`halt`**: the gates still fail after the fixer round. Run `ship.mjs halt --key gates-exhausted --reason "<reason>"`
   - **`continue-failing`**: `gates-exhausted` is not in `ship.halt_on`. The phase is recorded `failed` with a decision, and the run goes on

## Who Runs What

- **Inline track**: this session runs the checks that cover the change while it implements, then the full gates once before the one commit (see inline.md)
- **Builders and verifiers**: the scoped checks of their milestone, never the full suite unless their gate commands are the full gates (see milestones.md)
- **After a parallel batch**: the combined checks of the integrated milestones (`milestone gates --files <a,b>`) run once in the main tree, then the full gates in `final-gates` (see milestones.md)
- **Review fixes** (internal and pull request rounds): the fixer runs the scoped checks of the files it touches (`milestone gates --files <a,b>`) while it fixes, then the full gates once before its commit (internal rounds, which come after `final-gates`) or before its push (pull request rounds). Pass both command sets in its spawn prompt

Make a gate pass by fixing the code, with the gate command unchanged: never disable, skip or weaken a gate. Report a failure that is pre-existing and unrelated to the change as a blocker, and leave its cause untouched.
