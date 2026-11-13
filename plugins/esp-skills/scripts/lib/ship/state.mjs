// esp-ship state: <run-dir>/ship.json, its checks, and the helpers shared by
// the ship modules (files, git, the frozen config and its settings).
//
// ship.json is the only state file of esp-ship. It records the track (inline
// or orchestrated), who owns the run, the phase list of the track, the facts
// the phases produced, the loops, the limits and the stop or halt. The
// milestone state of the orchestrated track lives in <run-dir>/state.json
// (see milestones.mjs), under its reserved contract name.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ConfigError,
  expandHome,
  findRepoRoot,
  loadConfig
} from "../../config.mjs";
import { withLock } from "../lock.mjs";
import { now } from "../../runs.mjs";

export class ShipError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "ShipError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
export const TRACKS = ["inline", "orchestrated"];
export const OWNERS = ["self", "caller"];

/** Every phase, in canonical order. Each track runs its own subset. */
export const PHASES = [
  "plan",
  "context",
  "branch",
  "implement",
  "build",
  "final-gates",
  "review",
  "pr",
  "fix-review",
  "merge"
];
/** The shared tail of both tracks. */
export const TAIL_PHASES = ["pr", "fix-review", "merge"];
/** Tail phases that need an open pull request. */
export const WAIT_PHASES = ["fix-review", "merge"];
/**
 * The step of the review and checks wait that starts each fix round. It is a
 * step of the fix-review phase, not a phase of its own.
 */
export const WAIT_STEP = "fix-review-wait";
export const TRACK_PHASES = {
  inline: ["context", "branch", "implement", ...TAIL_PHASES],
  orchestrated: [
    "plan",
    "branch",
    "build",
    "final-gates",
    "review",
    ...TAIL_PHASES
  ]
};
/** The phase a track cannot drop. */
export const CORE_PHASE = { inline: "implement", orchestrated: "build" };
export const PHASE_STATUSES = [
  "pending",
  "started",
  "done",
  "skipped",
  "failed"
];
export const HALT_KEYS = [
  "critical-security",
  "gates-exhausted",
  "scope-change",
  "destructive-action",
  "budget"
];
export const INTERACTIVE_MODES = ["off", "plan", "all"];
export const ESCALATION_TRIGGERS = ["files", "design", "gates"];
export const GATE_FAILURE_LIMIT = 2;
export const SHA = /^[0-9a-f]{7,64}$/;
export const FINISHED = new Set(["done", "merged"]);

// ---------------------------------------------------------------------------
// Files and options
// ---------------------------------------------------------------------------

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new ShipError(
      `${path}: ${err.code === "ENOENT" ? "file not found" : `invalid JSON (${err.message})`}`
    );
  }
}

export function writeJson(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function runDirOf(options) {
  if (!options["run-dir"])
    throw new ShipError("--run-dir <path> is required", 2);
  const dir = resolve(expandHome(String(options["run-dir"])));
  if (!existsSync(join(dir, "run.json")))
    throw new ShipError(`Not a run directory (no run.json): ${dir}`);
  return dir;
}

export const runJson = (dir) => readJson(join(dir, "run.json"));
export const statePath = (dir) => join(dir, "ship.json");

/** A string option value, or null when absent or given without a value. */
export const stringOption = (value) =>
  value === undefined || value === null || value === true
    ? null
    : String(value);

export function positiveInt(raw, name, min = 1) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min)
    throw new ShipError(`--${name} must be an integer >= ${min}`, 2);
  return n;
}

export function parseJsonOption(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ShipError(`--${name}: invalid JSON (${err.message})`, 2);
  }
}

export function projectDirOf(options, state) {
  return resolve(
    expandHome(
      String(
        options["project-dir"] ??
          state?.project_dir ??
          findRepoRoot(process.cwd()) ??
          process.cwd()
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function configOf(snapshot) {
  try {
    return loadConfig({ snapshot }).config;
  } catch (err) {
    if (err instanceof ConfigError)
      throw new ShipError(err.message, err.exitCode ?? 1);
    throw err;
  }
}

/** Freeze the config once per run: an explicit snapshot wins, then the existing one. */
export function freezeConfig(dir, { snapshot, projectDir } = {}) {
  if (snapshot) return resolve(expandHome(String(snapshot)));
  const path = join(dir, "config.snapshot.json");
  if (!existsSync(path)) {
    try {
      writeJson(path, loadConfig({ projectDir }).config);
    } catch (err) {
      if (err instanceof ConfigError)
        throw new ShipError(err.message, err.exitCode ?? 1);
      throw err;
    }
  }
  return path;
}

/**
 * esp-ship settings for a track, from the `ship` config section, each key
 * falling back to its default.
 */
export function shipSettings(config, track = "orchestrated") {
  const ship = config?.ship ?? {};
  const inline = track === "inline";
  return {
    phases: ship.phases ?? TRACK_PHASES[track],
    internal_review_rounds: ship.internal_review_rounds ?? 2,
    worktree: ship.worktree ?? false,
    pr_draft_until_reviewed: ship.pr_draft_until_reviewed ?? true,
    halt_on: ship.halt_on ?? HALT_KEYS,
    max_files_changed: ship.inline?.max_files_changed ?? 10,
    escalate: ship.inline?.escalate ?? true,
    max_wall_minutes:
      ship.budgets?.[track]?.max_wall_minutes ?? (inline ? 60 : 240),
    max_milestones: ship.budgets?.orchestrated?.max_milestones ?? 12,
    max_retries_per_milestone: ship.max_retries_per_milestone ?? 2,
    // ship.parallel is auto|on|off. Only on builds batches for now: auto stays
    // sequential until the batch detection decides it.
    parallel: ship.parallel === "on",
    commit_per_milestone: ship.commit_per_milestone ?? true,
    gates: ship.gates ?? {},
    gates_scope: ship.gates_scope ?? "milestone",
    gates_always: ship.gates?.always ?? []
  };
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export function git(args, cwd, env = process.env) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.error) throw new ShipError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0)
    throw new ShipError(
      `git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`
    );
  return r.stdout;
}

export function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export const lines = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Files changed since `base`: committed, staged, unstaged and untracked. */
export function changedFiles(projectDir, base) {
  const tracked = lines(git(["diff", "--name-only", base], projectDir));
  const untracked = lines(
    git(["ls-files", "--others", "--exclude-standard"], projectDir)
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Patch of everything since `base`, untracked files included, without touching the index. */
export function workingPatch(projectDir, base) {
  const scratch = mkdtempSync(join(tmpdir(), "esp-ship-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    git(["read-tree", "HEAD"], projectDir, env);
    git(["add", "-A"], projectDir, env);
    return git(["diff", "--cached", "--binary", base], projectDir, env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export const isDirty = (projectDir) =>
  lines(git(["status", "--porcelain"], projectDir)).length > 0;

export function commitsSince(projectDir, base) {
  return lines(
    tryGit(["log", "--format=%H %s", `${base}..HEAD`], projectDir)
  ).map((line) => {
    const space = line.indexOf(" ");
    return { sha: line.slice(0, space), subject: line.slice(space + 1) };
  });
}

export const filesSince = (projectDir, base) =>
  lines(tryGit(["diff", "--name-only", `${base}..HEAD`], projectDir));

export const headOf = (projectDir) =>
  tryGit(["rev-parse", "HEAD"], projectDir)?.trim() ?? null;

// ---------------------------------------------------------------------------
// ship.json
// ---------------------------------------------------------------------------

/** Structural check of a state object; returns a list of error strings. */
export function checkState(state) {
  const errors = [];
  if (state?.state_format !== STATE_FORMAT)
    errors.push(`state_format: expected ${STATE_FORMAT}`);
  if (!TRACKS.includes(state?.track))
    errors.push(`track: expected one of ${TRACKS.join(", ")}`);
  if (!OWNERS.includes(state?.run_owner))
    errors.push(`run_owner: expected one of ${OWNERS.join(", ")}`);
  if (typeof state?.request !== "string" || state.request.trim() === "")
    errors.push("request: expected a non-empty string");
  if (!Array.isArray(state?.phases)) errors.push("phases: expected an array");
  const allowed = TRACK_PHASES[state?.track] ?? PHASES;
  for (const name of state?.phases ?? [])
    if (!allowed.includes(name))
      errors.push(`phases: ${name} is not a ${state.track} phase`);
  for (const [name, status] of Object.entries(state?.phase_status ?? {})) {
    if (!allowed.includes(name))
      errors.push(`phase_status.${name}: not a ${state?.track} phase`);
    if (!PHASE_STATUSES.includes(status))
      errors.push(
        `phase_status.${name}: expected one of ${PHASE_STATUSES.join(", ")}`
      );
  }
  if (!INTERACTIVE_MODES.includes(state?.interactive))
    errors.push(`interactive: expected one of ${INTERACTIVE_MODES.join(", ")}`);
  if (
    !Number.isInteger(state?.internal_review_rounds) ||
    state.internal_review_rounds < 0
  )
    errors.push("internal_review_rounds: expected an integer >= 0");
  if (!Number.isInteger(state?.pr_rounds?.max) || state.pr_rounds.max < 1)
    errors.push("pr_rounds.max: expected an integer >= 1");
  if (!Number.isInteger(state?.gate_failures) || state.gate_failures < 0)
    errors.push("gate_failures: expected an integer >= 0");
  if (state?.base_sha && !SHA.test(state.base_sha))
    errors.push("base_sha: expected a commit SHA");
  return errors;
}

export function readState(dir) {
  const path = statePath(dir);
  if (!existsSync(path))
    throw new ShipError(`No ship.json in ${dir}: run "ship.mjs init" first`);
  const state = readJson(path);
  const errors = checkState(state);
  if (errors.length > 0)
    throw new ShipError(`Invalid ${path}:\n  ${errors.join("\n  ")}`);
  return state;
}

/** Read-modify-write ship.json under its lock; returns fn's result, else the state. */
export function updateState(dir, fn, env) {
  const path = statePath(dir);
  return withLock(path, () => {
    const state = readState(dir);
    const result = fn(state);
    state.updated_at = now(env).toISOString();
    const errors = checkState(state);
    if (errors.length > 0)
      throw new ShipError(
        `Refusing to write invalid state:\n  ${errors.join("\n  ")}`
      );
    writeJson(path, state);
    return result ?? state;
  });
}

export function writeNewState(dir, state) {
  const errors = checkState(state);
  if (errors.length > 0)
    throw new ShipError(`Invalid state:\n  ${errors.join("\n  ")}`);
  withLock(statePath(dir), () => writeJson(statePath(dir), state));
}

/** Skip the phases still pending or started (a halt, a stop or an escalation). */
export function skipUnfinished(state) {
  const unfinished = {};
  for (const p of state.phases)
    if (["pending", "started"].includes(state.phase_status[p])) {
      unfinished[p] = state.phase_status[p];
      state.phase_status[p] = "skipped";
    }
  return unfinished;
}

// ---------------------------------------------------------------------------
// Step results
// ---------------------------------------------------------------------------

/** Steps named `<prefix>-<N>`, keyed by N. */
export function stepsByRound(steps, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const byRound = new Map();
  for (const s of steps) {
    const m = re.exec(s.name);
    if (m) byRound.set(Number(m[1]), s);
  }
  return byRound;
}

/** Result of the latest step with that exact name, or null. */
export const latestNamed = (steps, name) =>
  steps.filter((s) => s.name === name).at(-1)?.result ?? null;
