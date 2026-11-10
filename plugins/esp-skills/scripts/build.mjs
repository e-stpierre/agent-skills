#!/usr/bin/env node
// esp-build milestone state (`<run-dir>/state.json`).
//
// Keeps the milestone loop of esp-build deterministic: which milestone runs
// next, how many attempts it had, which commit it produced, and which model
// and gates its builder and verifier use. esp-build calls this script between
// subagent spawns, so no SKILL.md writes state.json by hand.
//
// state.json is not a contract artifact: the contract only reserves its name.
// Its `milestones.<id>.status` values are read by plan.mjs (`completedFromState`)
// and by esp-plan --amend, so `done` must keep its meaning.
//
// Exit codes: 0 success, 1 invalid state or failed operation, 2 usage error.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome, loadConfig } from "./config.mjs";
import { withLock } from "./lib/lock.mjs";
import { readPlan } from "./plan.mjs";
import { appendEvent, latestPlan, now } from "./runs.mjs";

export class BuildError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "BuildError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
export const MILESTONE_STATUSES = [
  "pending",
  "in-progress",
  "failed",
  "done",
  "halted"
];
export const GATE_NAMES = ["test", "lint", "typecheck", "build"];
const SHA = /^[0-9a-f]{7,64}$/;
const MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new BuildError(
      `${path}: ${err.code === "ENOENT" ? "file not found" : `invalid JSON (${err.message})`}`
    );
  }
}

function writeJson(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function runDirOf(options) {
  if (!options["run-dir"])
    throw new BuildError("--run-dir <path> is required", 2);
  const dir = resolve(expandHome(String(options["run-dir"])));
  if (!existsSync(join(dir, "run.json")))
    throw new BuildError(`Not a run directory (no run.json): ${dir}`);
  return dir;
}

const statePath = (dir) => join(dir, "state.json");

export function readState(dir) {
  const path = statePath(dir);
  if (!existsSync(path))
    throw new BuildError(`No state.json in ${dir}: run "build.mjs init" first`);
  const state = readJson(path);
  const errors = checkState(state);
  if (errors.length > 0)
    throw new BuildError(`Invalid ${path}:\n  ${errors.join("\n  ")}`);
  return state;
}

/** Structural check of a state object; returns a list of error strings. */
export function checkState(state) {
  const errors = [];
  if (state?.state_format !== STATE_FORMAT)
    errors.push(`state_format: expected ${STATE_FORMAT}`);
  if (!Array.isArray(state?.order))
    errors.push("order: expected an array of milestone IDs");
  if (typeof state?.milestones !== "object" || state.milestones === null) {
    errors.push("milestones: expected an object");
    return errors;
  }
  for (const id of state.order ?? [])
    if (!state.milestones[id])
      errors.push(`order: ${id} has no milestones entry`);
  for (const [id, m] of Object.entries(state.milestones)) {
    if (!MILESTONE_STATUSES.includes(m?.status))
      errors.push(
        `milestones.${id}.status: expected one of ${MILESTONE_STATUSES.join(", ")}`
      );
    if (!Number.isInteger(m?.attempts) || m.attempts < 0)
      errors.push(`milestones.${id}.attempts: expected an integer >= 0`);
    if (m?.status === "done" && !SHA.test(m.commit ?? ""))
      errors.push(`milestones.${id}.commit: required when done`);
  }
  return errors;
}

/** Read-modify-write state.json under its lock. */
function updateState(dir, fn, env) {
  const path = statePath(dir);
  return withLock(path, () => {
    const state = readState(dir);
    const result = fn(state);
    state.updated_at = now(env).toISOString();
    const errors = checkState(state);
    if (errors.length > 0)
      throw new BuildError(
        `Refusing to write invalid state:\n  ${errors.join("\n  ")}`
      );
    writeJson(path, state);
    return result ?? state;
  });
}

// ---------------------------------------------------------------------------
// init: create state.json from the plan, or sync it with an amended plan
// ---------------------------------------------------------------------------

function milestoneEntry(m) {
  return {
    title: m.title,
    complexity: m.complexity ?? "medium",
    depends: m.depends ?? [],
    files: m.files ?? [],
    status: "pending",
    attempts: 0,
    base: null,
    commit: null,
    started_at: null,
    ended_at: null,
    last_failure: null
  };
}

export function cmdInit(options, env = process.env) {
  const dir = runDirOf(options);
  const planFile = options.plan
    ? resolve(expandHome(String(options.plan)))
    : latestPlan(dir).path;
  if (!planFile)
    throw new BuildError(
      `No plan in ${dir}: pass --plan <file> or run esp-plan first`
    );
  const { plan, errors } = readPlan(planFile);
  if (errors.length > 0)
    throw new BuildError(
      `Plan does not lint (${planFile}):\n  ${errors.join("\n  ")}`
    );
  if (plan.milestones.length === 0)
    throw new BuildError(`Plan has no milestones: ${planFile}`);

  // Freeze the config for deterministic resume: an explicit snapshot wins,
  // otherwise the merged config is written next to state.json once.
  const path = statePath(dir);
  const existing = existsSync(path) ? readState(dir) : null;
  let snapshot = options["config-snapshot"]
    ? resolve(expandHome(String(options["config-snapshot"])))
    : existing?.config_snapshot;
  if (!snapshot) {
    snapshot = join(dir, "config.snapshot.json");
    const { config } = loadConfig({ projectDir: options["project-dir"] });
    writeJson(snapshot, config);
  }
  const config = loadConfig({ snapshot }).config;

  return withLock(path, () => {
    const at = now(env).toISOString();
    const current = existsSync(path) ? readState(dir) : null;
    const state = current ?? {
      state_format: STATE_FORMAT,
      workflow: "esp-build",
      created_at: at,
      base: options.base ?? null,
      order: [],
      milestones: {}
    };
    const ids = new Set(plan.milestones.map((m) => m.id));
    const changes = { added: [], removed: [], kept: [] };
    for (const [id, m] of Object.entries(state.milestones)) {
      if (ids.has(id)) continue;
      if (m.status === "done")
        throw new BuildError(
          `Completed milestone ${id} is missing from ${planFile}`
        );
      delete state.milestones[id];
      changes.removed.push(id);
    }
    for (const m of plan.milestones) {
      const prev = state.milestones[m.id];
      if (!prev) {
        state.milestones[m.id] = milestoneEntry(m);
        changes.added.push(m.id);
      } else {
        // Refresh plan-owned fields of milestones that are not done yet.
        if (prev.status !== "done")
          Object.assign(prev, {
            title: m.title,
            complexity: m.complexity ?? "medium",
            depends: m.depends,
            files: m.files
          });
        changes.kept.push(m.id);
      }
    }
    Object.assign(state, {
      plan_path: planFile,
      plan_version: plan.version,
      config_snapshot: snapshot,
      max_retries: config.build.max_retries_per_milestone,
      parallel: config.build.parallel,
      commit_per_milestone: config.build.commit_per_milestone,
      order: plan.milestones.map((m) => m.id),
      updated_at: at
    });
    if (options.base && !state.base) state.base = options.base;
    const errs = checkState(state);
    if (errs.length > 0)
      throw new BuildError(
        `Refusing to write invalid state:\n  ${errs.join("\n  ")}`
      );
    writeJson(path, state);
    return {
      state_path: path,
      created: !current,
      plan_version: plan.version,
      ...changes,
      config_snapshot: snapshot
    };
  });
}

// ---------------------------------------------------------------------------
// next: the milestone (or parallel batch) to run now
// ---------------------------------------------------------------------------

const normalizeFile = (f) =>
  String(f).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** True when two file lists share a file, or one is a directory of the other. */
export function filesOverlap(a, b) {
  const left = a.map(normalizeFile);
  const right = b.map(normalizeFile);
  return left.some((x) =>
    right.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`))
  );
}

/**
 * Decide what runs next. Returns `{ action, milestone, batch, attempt, amend, ... }`:
 * - `run`: start `milestone` (attempt 1) or the whole `batch` (parallel)
 * - `retry`: run `milestone` again; `amend` is the commit to amend, if any
 * - `halt`: `milestone` exhausted its retries or is halted
 * - `done`: every milestone is done
 * - `blocked`: nothing is runnable (a dependency is missing from the plan)
 */
export function nextStep(state, { parallel = false, only } = {}) {
  const ms = state.milestones;
  const order = state.order;
  const remaining = order.filter((id) => ms[id].status !== "done");
  const base = {
    remaining,
    done: order.filter((id) => ms[id].status === "done")
  };
  const halted = order.find((id) => ms[id].status === "halted");
  if (halted)
    return {
      ...base,
      action: "halt",
      milestone: halted,
      reason: ms[halted].last_failure ?? "milestone halted"
    };
  if (remaining.length === 0)
    return { ...base, action: "done", milestone: null, batch: [] };

  const allowed = 1 + state.max_retries;
  const current = order.find((id) =>
    ["in-progress", "failed"].includes(ms[id].status)
  );
  if (current) {
    const m = ms[current];
    if (m.attempts >= allowed)
      return {
        ...base,
        action: "halt",
        milestone: current,
        reason: `gates still failing after ${m.attempts} attempts (build.max_retries_per_milestone: ${state.max_retries})`
      };
    return {
      ...base,
      action: "retry",
      milestone: current,
      batch: [current],
      attempt: m.attempts + 1,
      amend: m.commit ?? null,
      last_failure: m.last_failure
    };
  }

  const runnable = remaining.filter(
    (id) =>
      ms[id].status === "pending" &&
      ms[id].depends.every((d) => ms[d]?.status === "done")
  );
  if (only && only !== "next") {
    if (!ms[only]) throw new BuildError(`Unknown milestone: ${only}`, 2);
    if (ms[only].status === "done")
      return {
        ...base,
        action: "done",
        milestone: only,
        batch: [],
        note: `${only} is already done`
      };
    if (!runnable.includes(only))
      return {
        ...base,
        action: "blocked",
        milestone: only,
        batch: [],
        reason: `${only} depends on ${ms[only].depends.filter((d) => ms[d]?.status !== "done").join(", ")}`
      };
    return {
      ...base,
      action: "run",
      milestone: only,
      batch: [only],
      attempt: 1,
      amend: null
    };
  }
  if (runnable.length === 0)
    return {
      ...base,
      action: "blocked",
      milestone: null,
      batch: [],
      reason: "no milestone has all its dependencies done"
    };

  const batch = [runnable[0]];
  if (parallel) {
    for (const id of runnable.slice(1)) {
      if (ms[id].files.length === 0 || ms[batch[0]].files.length === 0) break;
      if (batch.some((b) => filesOverlap(ms[b].files, ms[id].files))) continue;
      batch.push(id);
    }
  }
  return {
    ...base,
    action: "run",
    milestone: batch[0],
    batch,
    attempt: 1,
    amend: null
  };
}

export function cmdNext(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  return nextStep(state, {
    parallel:
      options.parallel === true ||
      (options.parallel === undefined && state.parallel),
    only: options.milestone
  });
}

// ---------------------------------------------------------------------------
// start / finish: one attempt of one milestone
// ---------------------------------------------------------------------------

function milestoneOf(state, id) {
  if (!id) throw new BuildError("A milestone ID is required", 2);
  const m = state.milestones[id];
  if (!m) throw new BuildError(`Unknown milestone: ${id}`, 2);
  return m;
}

export function cmdStart(id, options, env = process.env) {
  const dir = runDirOf(options);
  const entry = updateState(
    dir,
    (state) => {
      const m = milestoneOf(state, id);
      if (m.status === "done" || m.status === "halted")
        throw new BuildError(`${id} is ${m.status}; it cannot start again`);
      if (m.attempts >= 1 + state.max_retries)
        throw new BuildError(`${id} has no attempts left (${m.attempts})`);
      // An interrupted attempt (status still in-progress) counts as used.
      m.status = "in-progress";
      m.attempts += 1;
      m.started_at = now(env).toISOString();
      m.ended_at = null;
      if (m.base === null) m.base = options.base ?? null;
      return {
        milestone: id,
        attempt: m.attempts,
        base: m.base,
        amend: m.commit
      };
    },
    env
  );
  appendEvent(
    dir,
    "iteration.started",
    { milestone: id, attempt: entry.attempt },
    env
  );
  return entry;
}

export function cmdFinish(id, options, env = process.env) {
  const dir = runDirOf(options);
  const status = options.status;
  if (!["done", "failed", "halted"].includes(status))
    throw new BuildError("--status must be done, failed or halted", 2);
  const commit =
    options.commit && options.commit !== true ? String(options.commit) : null;
  if (commit && !SHA.test(commit))
    throw new BuildError(`--commit must be a commit SHA, got ${commit}`, 2);
  const entry = updateState(
    dir,
    (state) => {
      const m = milestoneOf(state, id);
      // A failed milestone can be marked halted (retries exhausted) without a new attempt.
      const haltFailed = status === "halted" && m.status === "failed";
      if (m.status !== "in-progress" && !haltFailed)
        throw new BuildError(
          `${id} is ${m.status}, not in-progress: run "start ${id}" first`
        );
      if (status === "done" && !commit && !m.commit)
        throw new BuildError(
          "--commit <sha> is required with --status done",
          2
        );
      if (commit) m.commit = commit;
      m.status = status;
      m.ended_at = now(env).toISOString();
      m.last_failure =
        status === "done"
          ? null
          : options.reason && options.reason !== true
            ? String(options.reason)
            : (m.last_failure ?? status);
      return {
        milestone: id,
        status,
        attempt: m.attempts,
        commit: m.commit,
        attempts_left: Math.max(0, 1 + state.max_retries - m.attempts)
      };
    },
    env
  );
  if (status === "done")
    appendEvent(
      dir,
      "commit.created",
      { milestone: id, sha: entry.commit },
      env
    );
  appendEvent(
    dir,
    "iteration.completed",
    { milestone: id, attempt: entry.attempt, status },
    env
  );
  return entry;
}

// ---------------------------------------------------------------------------
// models: builder and verifier model for a milestone (model-selection.md)
// ---------------------------------------------------------------------------

function choice(entry) {
  if (!entry?.model) return null;
  return entry.effort
    ? { model: entry.model, effort: entry.effort }
    : { model: entry.model };
}

/**
 * Resolve the builder and verifier models. Precedence:
 * --model flag -> milestone complexity -> config role -> agent frontmatter.
 */
export function resolveModels(config, complexity = "medium", flags = {}) {
  const models = config.defaults?.models ?? {};
  const fromFlag = flags.model
    ? { model: flags.model, ...(flags.effort ? { effort: flags.effort } : {}) }
    : null;
  const builder = fromFlag ??
    choice(models.builder?.[complexity]) ??
    choice(models.builder?.medium) ?? { model: "opus", source: "frontmatter" };
  const verifier = choice(models.verifier) ?? {
    model: "sonnet",
    source: "frontmatter"
  };
  return { builder, verifier };
}

export function cmdModels(id, options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const m = milestoneOf(state, id);
  const model =
    options.model && options.model !== true ? String(options.model) : null;
  if (model && !MODEL_ALIASES.has(model))
    throw new BuildError(
      `--model must be one of ${[...MODEL_ALIASES].join(", ")}`,
      2
    );
  const config = loadConfig({ snapshot: state.config_snapshot }).config;
  return {
    milestone: id,
    complexity: m.complexity,
    ...resolveModels(config, m.complexity, { model, effort: options.effort })
  };
}

// ---------------------------------------------------------------------------
// gates: configured gate commands, else detected from the project
// ---------------------------------------------------------------------------

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function packageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    return "bun";
  return "npm";
}

/** Detect gate commands from the project files at `root`. */
export function detectGates(root) {
  const gates = Object.fromEntries(GATE_NAMES.map((g) => [g, null]));
  const pkgText = readText(join(root, "package.json"));
  if (pkgText) {
    let scripts = {};
    try {
      scripts = JSON.parse(pkgText).scripts ?? {};
    } catch {
      scripts = {};
    }
    const pm = packageManager(root);
    const runScript = (name) =>
      pm === "npm"
        ? name === "test"
          ? "npm test"
          : `npm run ${name}`
        : `${pm} ${name}`;
    const pick = (...names) =>
      names.find((n) => typeof scripts[n] === "string");
    for (const [gate, names] of [
      ["test", ["test"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["build", ["build"]]
    ]) {
      const name = pick(...names);
      if (name && !(gate === "test" && /no test specified/.test(scripts[name])))
        gates[gate] = runScript(name);
    }
    return gates;
  }
  const pyproject = readText(join(root, "pyproject.toml"));
  if (pyproject !== null) {
    if (/\bpytest\b/.test(pyproject) || existsSync(join(root, "tests")))
      gates.test = "uv run pytest";
    if (/\[tool\.ruff/.test(pyproject)) gates.lint = "uv run ruff check";
    if (/\[tool\.mypy/.test(pyproject)) gates.typecheck = "uv run mypy .";
    return gates;
  }
  if (existsSync(join(root, "Cargo.toml")))
    return {
      test: "cargo test",
      lint: "cargo clippy",
      typecheck: null,
      build: "cargo build"
    };
  if (existsSync(join(root, "go.mod")))
    return {
      test: "go test ./...",
      lint: "go vet ./...",
      typecheck: null,
      build: "go build ./..."
    };
  const makefile = readText(join(root, "Makefile"));
  if (makefile) {
    for (const gate of ["test", "lint", "build"])
      if (new RegExp(`^${gate}:`, "m").test(makefile))
        gates[gate] = `make ${gate}`;
  }
  return gates;
}

export function cmdGates(options) {
  const root = resolve(
    expandHome(String(options["project-dir"] ?? process.cwd()))
  );
  let snapshot = options["config-snapshot"];
  if (!snapshot && options["run-dir"])
    snapshot = readState(runDirOf(options)).config_snapshot;
  const configured = loadConfig({ snapshot, projectDir: root }).config.build
    .gates;
  const detected = detectGates(root);
  const gates = {};
  const sources = {};
  for (const g of GATE_NAMES) {
    if (configured[g]) [gates[g], sources[g]] = [configured[g], "config"];
    else if (detected[g]) [gates[g], sources[g]] = [detected[g], "detected"];
    else [gates[g], sources[g]] = [null, "none"];
  }
  return { project_dir: root, gates, sources };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node build.mjs <command> [args] --run-dir <path> [options]

Commands:
  init                 Create state.json from the latest plan (or --plan), or sync it with
                       an amended plan. Freezes the config in config.snapshot.json
  next                 What to run now: { action: run|retry|halt|done|blocked, milestone, batch }
  start <id>           Begin an attempt of a milestone (emits iteration.started)
  finish <id>          End the attempt: --status done|failed|halted [--commit <sha>] [--reason <text>]
  models <id>          Builder and verifier { model, effort } for a milestone
  gates                Gate commands: build.gates from config, else detected from the project
  show                 Print state.json

Options:
  --run-dir <path>          Run directory (required except by gates)
  --plan <file>             Plan file for init (default: latest plan in the run dir)
  --base <sha>              Commit the build started from (init) or the milestone started from (start)
  --milestone <id|next>     next: consider only this milestone (single-milestone mode)
  --parallel                next: return a batch of runnable milestones with disjoint files
  --model <alias>           models: override the builder model (opus, sonnet, haiku, fable)
  --effort <level>          models: effort for the --model override
  --config-snapshot <path>  Config snapshot (init, gates)
  --project-dir <dir>       Project root (init config, gates detection)
  --help                    Show this help`;

const BOOLEAN_FLAGS = new Set(["parallel", "help"]);

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") options.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (BOOLEAN_FLAGS.has(key))
        options[key] = eq === -1 ? true : arg.slice(eq + 1) !== "false";
      else {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined)
          throw new BuildError(`--${key} requires a value`, 2);
        options[key] = value;
      }
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function run(argv, env = process.env) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command)
    return { output: USAGE, exitCode: command ? 0 : 2 };
  switch (command) {
    case "init":
      return { output: cmdInit(options, env) };
    case "next":
      return { output: cmdNext(options) };
    case "start":
      return { output: cmdStart(args[0], options, env) };
    case "finish":
      return { output: cmdFinish(args[0], options, env) };
    case "models":
      return { output: cmdModels(args[0], options) };
    case "gates":
      return { output: cmdGates(options) };
    case "show":
      return { output: readState(runDirOf(options)) };
    default:
      throw new BuildError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    (exitCode === 0 || typeof output !== "string"
      ? process.stdout
      : process.stderr
    ).write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = [
      "BuildError",
      "ConfigError",
      "RunsError",
      "PlanError"
    ].includes(err.name);
    process.stderr.write(
      `build error: ${known ? err.message : (err.stack ?? err)}\n`
    );
    process.exitCode = known ? (err.exitCode ?? 1) : 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
