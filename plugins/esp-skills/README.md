# ESP Skills

## Overview

A single plugin bundling every skill in this repository: standardized git workflows, GitHub PR maintenance, high-signal code review, interactive SDLC planning and analysis, lightweight helpers, markdown style enforcement, and skill authoring. Skills are human-in-the-loop by default: they infer what they can from context and ask clarifying questions only when needed. Skills marked **Beta** are usable but may change.

Every skill is invoked as `/esp-skills:<skill>`. Unqualified names (`/esp-commit`, `/esp-qna`) also work as long as no other installed plugin provides a skill with the same name.

- `/esp-skills:esp-branch feature add-oauth 123` - Create a branch with standardized naming
- `/esp-skills:esp-commit` - Commit changes with a structured message
- `/esp-skills:esp-pr` - Create a pull request with a contextual description
- `/esp-skills:esp-fix-pr 42` - Fix review comments and CI failures on a PR
- `/esp-skills:esp-code-review PR 123` - Review a pull request for high-signal issues
- `/esp-skills:esp-plan feature Add OAuth login` - Plan a feature as parseable milestones in a run directory
- `/esp-skills:esp-build --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login` - Build the plan, one verified commit per milestone
- `/esp-skills:esp-analyze security` - Analyze the codebase for security issues
- `/esp-skills:esp-qna How does OAuth 2.0 work?` - Get a concise answer without code changes
- `/esp-skills:esp-config set pr.draft true` - Change a configuration default

## Agents

Subagents spawned by the workflow skills. Each returns a contract result block and keeps details in the run dir. Spawn sites pass the model and effort of the role from the config (see `references/model-selection.md`); the frontmatter model is only a fallback.

| Agent                     | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `esp-skills:esp-builder`  | Implements one milestone or one set of review fixes as exactly one commit           |
| `esp-skills:esp-reviewer` | Read-only, fresh-context review with a find and verify pass and classified findings |
| `esp-skills:esp-verifier` | Re-runs gates and checks acceptance criteria without changing code                  |

## Skills

### Git

| Skill                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `/esp-skills:esp-branch` | Create branches with standardized naming conventions |
| `/esp-skills:esp-commit` | Commit changes with structured messages              |
| `/esp-skills:esp-pr`     | Create pull requests with contextual descriptions    |

### Config

| Skill                    | Description                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| `/esp-skills:esp-config` | Initialize, show, get, set, and validate the esp-skills configuration |

### GitHub

| Skill                    | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `/esp-skills:esp-fix-pr` | **Beta** - Fix review comments and failing CI checks on a PR, then push fixes |

### Code Review

| Skill                         | Description                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `/esp-skills:esp-code-review` | Review a diff (local changes, a ref range, or a PR) for high-signal issues |

### SDLC

| Skill                       | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `/esp-skills:esp-plan`      | **Beta** - Create or amend a machine-readable implementation plan    |
| `/esp-skills:esp-build`     | **Beta** - Build a plan with one verified commit per milestone       |
| `/esp-skills:esp-analyze`   | **Beta** - Analyze codebase for bugs, debt, docs, security, or style |

### Helpers

| Skill                        | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `/esp-skills:esp-qna`        | Answer user questions with clear, concise responses |
| `/esp-skills:esp-rubberduck` | Rubber duck debugging and idea clarification        |

### Style

| Skill                      | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `/esp-skills:esp-markdown` | **Beta** - Enforce markdown formatting conventions and non-auto-fixable lint rules |

### Skill Building

| Skill                          | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `/esp-skills:esp-create-skill` | **Beta** - Create a new Claude Code skill following best practices |

## Configuration

Configuration is optional. Every skill works with the built-in defaults, and `/esp-skills:esp-config` creates and edits config files. Skills resolve their settings through `scripts/config.mjs`, which merges these layers (later wins):

1. Built-in defaults: `references/config-defaults.json`
2. User config: `~/.esp-skills/config.json` (`ESP_SKILLS_HOME` overrides `~/.esp-skills`)
3. Project config: `<repo>/.esp-skills/config.json`
4. Config snapshot (`--config-snapshot <path>`): replaces the user and project layers for one run
5. Skill arguments

Objects merge key by key; arrays and scalars replace. Invalid config fails with the file, key path and expected type. Files are validated against `references/config.schema.json`; add its URL as `$schema` for editor completion:

```json
{
  "$schema": "https://raw.githubusercontent.com/e-stpierre/skills/main/plugins/esp-skills/references/config.schema.json",
  "version": 1,
  "pr": { "draft": true },
  "commit": { "style": "conventional" }
}
```

Keys read by the current skills:

| Key                            | Default                                   | Read by                | Effect                                                 |
| ------------------------------ | ----------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `defaults.language`            | `en-US`                                   | `esp-commit`, `esp-pr` | Language of generated messages                         |
| `branch.pattern`               | `{category}/{issue}_{name}`               | `esp-branch`           | Branch name when an issue ID is known                  |
| `branch.pattern_without_issue` | `{category}/{name}`                       | `esp-branch`           | Branch name when no issue ID is known                  |
| `branch.default_category`      | `feature`                                 | `esp-branch`           | Category when none is given or inferred                |
| `branch.categories`            | `feature, fix, chore, doc, refactor, poc` | `esp-branch`           | Suggested categories (others still work)               |
| `commit.style`                 | `plain`                                   | `esp-commit`           | `plain` imperative title or `conventional` commits     |
| `commit.co_author`             | `true`                                    | `esp-commit`           | Add the `Co-Authored-By` trailer                       |
| `commit.plan_step_prefix`      | `true`                                    | `esp-commit`           | Prefix titles with `[Task N]` when following a plan    |
| `pr.base`                      | `null`                                    | `esp-pr`               | Base branch, `null` uses the repository default branch |
| `pr.draft`                     | `false`                                   | `esp-pr`               | Open PRs as drafts                                     |
| `pr.attribution`               | `true`                                    | `esp-pr`               | Append the AI attribution line                         |
| `analyze.output_dir`           | `analysis`                                | `esp-analyze`          | Directory for analysis reports                         |
| `plan.default_type`            | `auto`                                    | `esp-plan`             | Plan type when `--type` is not given                   |
| `plan.explore_agents`          | `feature: 3, bug: 2, chore: 2`            | `esp-plan`             | Explore subagents per plan type                        |
| `defaults.interactive`         | `off`                                     | `esp-plan`             | When skills stop to ask (`off`, `plan`, `all`)         |
| `defaults.models`              | see `references/model-selection.md`       | `esp-plan`, `esp-build` | Model and effort per subagent role                    |
| `build.max_retries_per_milestone` | `2`                                    | `esp-build`            | Builder retries before the build halts                 |
| `build.parallel`               | `false`                                   | `esp-build`            | Run disjoint milestones in parallel worktrees          |
| `build.commit_per_milestone`   | `true`                                    | `esp-build`            | `false` squashes milestone commits at the end          |
| `build.gates`                  | all `null` (auto-detect)                  | `esp-build`            | Gate commands: `test`, `lint`, `typecheck`, `build`    |
| `worktrees.root`               | `~/.esp-skills/worktrees`                 | `esp-build`            | Where parallel milestone worktrees are created         |
| `runs.root`                    | `~/.esp-skills/runs`                      | `scripts/runs.mjs`     | Where standalone run directories are created           |

Reserved keys are accepted and validated, but belong to skills that are not shipped yet. Their defaults are in `references/config-defaults.json`:

| Key                                    | Planned use                                                          |
| -------------------------------------- | -------------------------------------------------------------------- |
| `runs.retention_days`                  | Days to keep finished runs                                           |
| `worktrees.cleanup`                    | Worktree cleanup policy                                              |
| `commit.review_fixes`                  | Review-fix commit style                                              |
| `pr.body_from_run`, `pr.body_sections` | PR body built from run artifacts                                     |
| `review`                               | Review dimensions, minimum severity, finding verification            |
| `await-review`                         | Bot reviewers, triggers, timeout and polling                         |
| `fix-review`                           | Review fix rounds, CI fixes, deferred items                          |
| `merge`                                | Merge conditions and method                                          |
| `go`, `go-light`                       | Workflow phases, budgets and halt conditions                         |
| `recap`                                | Runs roots and fan-out                                               |

## Architecture

The SDLC skills (`esp-plan`, `esp-analyze`) accept an optional `[context]` argument as the last parameter. Providing context upfront replaces questions that would otherwise be asked interactively.

```bash
# With context - minimal prompts
/esp-skills:esp-plan bug "Login fails on Safari when using OAuth."

# Without context - interactive prompts
/esp-skills:esp-plan --interactive plan bug
```

The `esp-code-review` skill produces plain markdown and performs no write-side effects. Routing the review (stdout, PR comment, file, CI annotation) is the caller's responsibility.

### Plans

`esp-plan` writes plans in plan format 1 (`references/plan-format.md`): frontmatter, fixed sections, and milestones with an ID, goal, complexity, dependencies, files, tasks, acceptance criteria and validation commands. Each milestone is one commit. `scripts/plan.mjs` parses a plan into JSON, lints it, and checks an amendment against the previous version:

```bash
node scripts/plan.mjs parse ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md
node scripts/plan.mjs lint ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md
node scripts/plan.mjs diff plan.md plan.v2.md --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
```

- Plans live in the run directory, never in the repository, and are never edited once written
- An amendment writes `plan.v<N>.md`, keeps completed milestones unchanged, and is logged in `amendments.jsonl` and `decisions.jsonl`
- Plans never name models: milestone `complexity` selects the builder model from the config

### Builds

`esp-build` runs a plan milestone by milestone: an `esp-builder` subagent implements the milestone and commits, then an `esp-verifier` subagent re-runs the gates and checks the acceptance criteria. A failed verification retries the builder, which amends the milestone commit; exhausted retries halt the build. `scripts/build.mjs` keeps the loop state in `<run-dir>/state.json`:

```bash
node scripts/build.mjs init --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login --base "$(git rev-parse HEAD)"
node scripts/build.mjs next --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/build.mjs gates --project-dir .
```

- `state.json` records each milestone's status, attempts, base and commit, and the frozen config snapshot, so `--resume` continues where the build stopped
- `--milestone next` runs one milestone per invocation, for loop-driven harness steps
- An amended plan (`esp-plan --amend`) is picked up on the next call, and done milestones are kept

### Run Directories

Workflow skills record their work in a run directory that follows a draft harness contract (v1): `run.json`, step result blocks, `decisions.jsonl`, `events.jsonl`, operator messages and plan amendments. Standalone runs go to `<runs.root>/<YYYY-MM-DD>-<slug>`; a harness or parent run passes `--run-dir <path>` instead. Skills never write these files by hand: `scripts/runs.mjs` creates, updates, validates and indexes them. The schemas and fixtures are in `references/contract/v1/`, and `references/contract-notes.md` maps each contract requirement to the command that meets it.

```bash
node scripts/runs.mjs create fix-login-timeout --workflow esp-go-light
node scripts/runs.mjs index --last 7d --status merged,done --risk medium
node scripts/runs.mjs validate ~/.esp-skills/runs/2026-11-10-fix-login-timeout/events.jsonl
```

### Shared References

Workflow skills and agents share these references at the plugin root, reached through `${CLAUDE_PLUGIN_ROOT}`:

- `references/decision-policy.md`: classes A-Fix, B-Decide, B-Scope, Reject and Halt, interactive and autonomous behavior, `needs_input` under a harness, `go.halt_on` stop conditions, risk levels and decision logging
- `references/summary-template.md`: frontmatter and sections of a run `summary.md`
- `references/plan-format.md`: plan format 1, the milestone block, parsed JSON, amendments and plan-lint
- `references/model-selection.md`: roles and the model and effort precedence (`--model` -> milestone complexity -> config role -> agent frontmatter -> inherit)

## Complete Examples

### /esp-skills:esp-branch

**Arguments:**

- `<branch-name>` - Short kebab-case description (required)
- `[category]` - Branch type: feature (default), fix, chore, doc, poc, refactor
- `[issue-id]` - GitHub issue number
- `[base]` - Base branch to create from (defaults to current location)

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/esp-skills:esp-branch add-dark-mode

# With category
/esp-skills:esp-branch hotfix login-timeout

# With issue reference
/esp-skills:esp-branch feature add-oauth 123

# Branch from a specific base branch
/esp-skills:esp-branch feature add-oauth 123 develop
```

### /esp-skills:esp-commit

**Arguments:**

- `[message]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/esp-skills:esp-commit

# With custom message
/esp-skills:esp-commit Fix login timeout on Safari
```

### /esp-skills:esp-pr

**Arguments:**

- `[base-branch]` - Target branch for the PR (defaults to main/master)
- `[--draft]` - Create the PR as a draft

**Examples:**

```bash
# Create PR to default branch
/esp-skills:esp-pr

# Create PR to specific branch
/esp-skills:esp-pr develop

# Create draft PR
/esp-skills:esp-pr --draft
```

### /esp-skills:esp-config

**Arguments:**

- `<action>` - `init`, `show`, `get`, `set`, `unset`, `validate`, or `sources` (required)
- `[key]` - Section or dotted key for `get`, `set`, `unset`; a file path for `validate`
- `[value]` - Value for `set`, parsed as JSON when valid, otherwise a string
- `[--project]` - Target `<repo>/.esp-skills/config.json` instead of the user file
- `[--force]` - Overwrite an existing file on `init`

**Examples:**

```bash
# Create ~/.esp-skills/config.json
/esp-skills:esp-config init

# Create a project config in the current repository
/esp-skills:esp-config --project init

# Show the merged config, or one section or key
/esp-skills:esp-config show
/esp-skills:esp-config get pr
/esp-skills:esp-config get defaults.models.reviewer

# Change a value for every repository, or only this one
/esp-skills:esp-config set pr.draft true
/esp-skills:esp-config --project set pr.base develop
/esp-skills:esp-config set merge.preference '["squash","merge"]'

# Remove a key, validate all layers or one file, list layers
/esp-skills:esp-config unset pr.draft
/esp-skills:esp-config validate
/esp-skills:esp-config validate ./candidate-config.json
/esp-skills:esp-config sources
```

### /esp-skills:esp-fix-pr

**Arguments:**

- `<pr-number>` (required) - The pull request number to fix

**Examples:**

```bash
# Fix all review comments and CI failures on PR 42
/esp-skills:esp-fix-pr 42
```

### /esp-skills:esp-code-review

**Arguments:**

- `[target]` - What to review. Omit for local changes. Accepts `staged`, `unstaged`, a ref (`main`, `origin/main`), a range (`main..HEAD`), or a PR reference (`PR 123`, `#123`).

**Examples:**

```bash
# Review all local changes (staged + unstaged, or branch vs default if clean)
/esp-skills:esp-code-review

# Review only staged changes, e.g. as a pre-commit sanity check
/esp-skills:esp-code-review staged

# Review the current branch against main
/esp-skills:esp-code-review main

# Review an explicit range
/esp-skills:esp-code-review origin/main..HEAD

# Review a GitHub pull request (requires gh to be authenticated)
/esp-skills:esp-code-review PR 123
/esp-skills:esp-code-review #123
```

### /esp-skills:esp-plan

**Arguments:**

- `[--amend]` - Amend the latest plan in `--run-dir`; `[context]` is the amendment (text or file)
- `[--interactive <mode>]` - `off`, `plan` or `all` (default: `defaults.interactive`)
- `[--type <type>]` - `feature`, `bug`, `chore` or `auto` (default: `plan.default_type`); a leading bare type word also works
- `[--run-dir <path>]` - Use an existing run directory (default: a new run under `runs.root`)
- `[--config-snapshot <path>]` - Config snapshot from a harness or parent run
- `[context]` - Task description, issue URL or document path

**Examples:**

```bash
# Plan a feature with context
/esp-skills:esp-plan feature Add user authentication with OAuth for Google and GitHub

# Plan a bug fix from an issue
/esp-skills:esp-plan --type bug https://github.com/acme/web/issues/42

# Plan a chore
/esp-skills:esp-plan chore Update all npm dependencies to latest versions

# Auto-detect type, and approve the plan before it is final
/esp-skills:esp-plan --interactive plan Fix the login timeout issue

# Amend the remaining milestones of an existing plan
/esp-skills:esp-plan --amend --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login Also support GitHub OAuth
```

### /esp-skills:esp-build

**Arguments:**

- `[--resume]` - Continue an existing build from `state.json`
- `[--parallel]` - Run milestones with disjoint files in parallel worktrees (default: `build.parallel`)
- `[--milestone <id>]` - Run one milestone and exit; `next` picks the next runnable one
- `[--model <alias>]` - Builder model for every milestone (`opus`, `sonnet`, `haiku`, `fable`)
- `[--interactive <mode>]` - `off`, `plan` or `all` (default: `defaults.interactive`)
- `[--run-dir <path>]` - Run directory that holds the plan (default: the plan's directory, or a new run)
- `[--config-snapshot <path>]` - Config snapshot from a harness or parent run
- `[plan]` - Plan file (default: the latest plan version in the run directory)

**Examples:**

```bash
# Build every milestone of a plan
/esp-skills:esp-build --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login

# Build from a plan path, with sonnet as the builder
/esp-skills:esp-build --model sonnet ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md

# Run only the next milestone, as a loop iteration would
/esp-skills:esp-build --milestone next --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login

# Resume an interrupted build, running independent milestones in parallel
/esp-skills:esp-build --resume --parallel --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
```

### /esp-skills:esp-analyze

**Arguments:**

- `<type>` - Analysis type: `bug`, `debt`, `doc`, `security`, or `style` (required)
- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Bug analysis
/esp-skills:esp-analyze bug
/esp-skills:esp-analyze bug Focus on error handling in API routes
/esp-skills:esp-analyze bug src/api/ src/services/

# Documentation analysis
/esp-skills:esp-analyze doc Check API documentation accuracy

# Technical debt analysis
/esp-skills:esp-analyze debt Focus on database access patterns

# Style analysis
/esp-skills:esp-analyze style Check naming conventions in React components

# Security analysis
/esp-skills:esp-analyze security Focus on authentication and session management
```

### /esp-skills:esp-qna

**Arguments:**

- `<question>` - The question to answer

**Examples:**

```bash
# Ask a technical question
/esp-skills:esp-qna What is the difference between let and const in JavaScript?

# Ask for best practices
/esp-skills:esp-qna What are the best practices for error handling in Node.js?
```

### /esp-skills:esp-rubberduck

**Arguments:**

- `<context>` - The idea, plan, code snippet, or issue to discuss

**Examples:**

```bash
# Clarify a plan
/esp-skills:esp-rubberduck I'm planning to extract the token validation logic into a separate middleware.

# Debug an issue
/esp-skills:esp-rubberduck My component is not re-rendering when the prop changes.

# Discuss a design decision
/esp-skills:esp-rubberduck Should we use Redux or Context API for state management in this project?
```

### /esp-skills:esp-markdown

This skill takes no arguments. It is automatically invoked when creating, editing, or reviewing markdown files.

```bash
# Review a markdown file for style issues
/esp-skills:esp-markdown
```

### /esp-skills:esp-create-skill

**Arguments:**

- `<skill-name>` - Name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`)
- `[context]` - Additional context about what the skill should do

**Examples:**

```bash
# Create a skill with just a name
/esp-skills:esp-create-skill deploy-staging

# Create a skill with context
/esp-skills:esp-create-skill review-pr A skill that reviews pull requests for code quality and security issues
```
