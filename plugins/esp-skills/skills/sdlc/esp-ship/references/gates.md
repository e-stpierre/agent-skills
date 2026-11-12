# Gates

The gate commands (`test`, `lint`, `typecheck`, `build`) that prove a change works. Resolve them once per run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" milestone gates --project-dir <repo-root>
```

It prints `{ gates, sources }`: each gate comes from `ship.gates.<name>` (`source: config`), else from the project files (`source: detected`: the `package.json` scripts with the package manager of the lockfile, `pyproject.toml`, `Cargo.toml`, `go.mod`, a `Makefile`), else none (`source: none`, skipped). With `--run-dir`, it reads the frozen config of the run.

## Who Runs Them

- **Inline track**: this session runs every gate before the one commit (see inline.md). A failure counts with `ship.mjs gate-failure`
- **Orchestrated track**: each builder gets the gate commands and runs them before its commit, and each verifier runs them again in a fresh context (see milestones.md). After a parallel batch, this session runs them once in the main tree
- **Review fixes**: the fixer runs the gates that cover its change before each commit

Never disable, skip or weaken a gate to make it pass. A failure that is pre-existing and unrelated to the change is a blocker to report, not a change to make.
