#!/usr/bin/env node
// esp-skills state and checks for esp-go-light.
//
// esp-go-light runs a small task from request to merged pull request in one
// session. This script keeps the deterministic parts out of the model: the
// phase list, the escalation limits (files changed, gate failures), the wall
// time budget, the escalation hand-off to esp-go, the pull request body built
// from the run artifacts, and the final result block. State lives in
// <run-dir>/go-light.json.
//
// Exit codes: 0 ok, 1 failure or invalid state, 2 usage. `escalate`, `halt`
// and `result` exit with the contract code of their result status (0 done or
// merged, 10 awaiting-human, 20 halted, 30 escalate, 1 failed).

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
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  expandHome,
  findRepoRoot,
  loadConfig
} from "./config.mjs";
import { exitCodeFor, validateArtifact } from "./lib/contract.mjs";
import { withLock } from "./lib/lock.mjs";
import {
  ATTRIBUTION,
  BODY_SECTIONS,
  collectRunArtifacts,
  readStepResults,
  renderPrBody
} from "./lib/pr-body.mjs";
import { appendDecision, appendEvent, cmdUpdate, now } from "./runs.mjs";

export class GoLightError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "GoLightError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
export const PHASES = [
  "context",
  "branch",
  "implement",
  "pr",
  "await-review",
  "fix-review",
  "merge"
];
export const WAIT_PHASES = ["await-review", "fix-review", "merge"];
export const PHASE_STATUSES = [
  "pending",
  "started",
  "done",
  "skipped",
  "failed"
];
export const TRIGGERS = ["files", "design", "gates"];
export const HALT_KEYS = [
  "critical-security",
  "gates-exhausted",
  "scope-change",
  "destructive-action",
  "budget"
];
export const GATE_FAILURE_LIMIT = 2;
const SHA = /^[0-9a-f]{7,64}$/;

// ---------------------------------------------------------------------------
// Files and git
// ---------------------------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new GoLightError(
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
    throw new GoLightError("--run-dir <path> is required", 2);
  const dir = resolve(expandHome(String(options["run-dir"])));
  if (!existsSync(join(dir, "run.json")))
    throw new GoLightError(`Not a run directory (no run.json): ${dir}`);
  return dir;
}

export function git(args, cwd, env = process.env) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.error) throw new GoLightError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0)
    throw new GoLightError(
      `git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`
    );
  return r.stdout;
}

const lines = (text) =>
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
  const scratch = mkdtempSync(join(tmpdir(), "esp-go-light-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    git(["read-tree", "HEAD"], projectDir, env);
    git(["add", "-A"], projectDir, env);
    return git(["diff", "--cached", "--binary", base], projectDir, env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function isDirty(projectDir) {
  return lines(git(["status", "--porcelain"], projectDir)).length > 0;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const statePath = (dir) => join(dir, "go-light.json");

/** Structural check of a state object; returns a list of error strings. */
export function checkState(state) {
  const errors = [];
  if (state?.state_format !== STATE_FORMAT)
    errors.push(`state_format: expected ${STATE_FORMAT}`);
  if (typeof state?.request !== "string" || state.request.trim() === "")
    errors.push("request: expected a non-empty string");
  if (!Array.isArray(state?.phases)) errors.push("phases: expected an array");
  for (const [name, status] of Object.entries(state?.phase_status ?? {})) {
    if (!PHASES.includes(name))
      errors.push(`phase_status.${name}: unknown phase`);
    if (!PHASE_STATUSES.includes(status))
      errors.push(
        `phase_status.${name}: expected one of ${PHASE_STATUSES.join(", ")}`
      );
  }
  if (!Number.isInteger(state?.gate_failures) || state.gate_failures < 0)
    errors.push("gate_failures: expected an integer >= 0");
  if (state?.base_sha && !SHA.test(state.base_sha))
    errors.push("base_sha: expected a commit SHA");
  return errors;
}

export function readState(dir) {
  const path = statePath(dir);
  if (!existsSync(path))
    throw new GoLightError(
      `No go-light.json in ${dir}: run "go-light.mjs init" first`
    );
  const state = readJson(path);
  const errors = checkState(state);
  if (errors.length > 0)
    throw new GoLightError(`Invalid ${path}:\n  ${errors.join("\n  ")}`);
  return state;
}

function updateState(dir, fn, env) {
  const path = statePath(dir);
  return withLock(path, () => {
    const state = readState(dir);
    const result = fn(state);
    state.updated_at = now(env).toISOString();
    const errors = checkState(state);
    if (errors.length > 0)
      throw new GoLightError(
        `Refusing to write invalid state:\n  ${errors.join("\n  ")}`
      );
    writeJson(path, state);
    return result ?? state;
  });
}

/**
 * Resolve the phases to run from `go-light.phases`. `implement` is required.
 * Without `pr`, the phases that need a pull request are skipped. With
 * --stop-before-wait, the wait phases are left to the caller.
 */
export function resolvePhases(
  configured = PHASES,
  { stopBeforeWait = false } = {}
) {
  const wanted = new Set(configured);
  if (!wanted.has("implement"))
    throw new GoLightError("go-light.phases must include implement", 1);
  const phases = [];
  const skipped = {};
  for (const phase of PHASES) {
    if (!wanted.has(phase)) {
      skipped[phase] = "not in go-light.phases";
    } else if (WAIT_PHASES.includes(phase) && !wanted.has("pr")) {
      skipped[phase] = "needs the pr phase";
    } else if (WAIT_PHASES.includes(phase) && stopBeforeWait) {
      skipped[phase] = "left to the caller (--stop-before-wait)";
    } else {
      phases.push(phase);
    }
  }
  return { phases, skipped };
}

function projectDirOf(options, state) {
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

function configOf(snapshot) {
  try {
    return loadConfig({ snapshot }).config;
  } catch (err) {
    if (err instanceof ConfigError)
      throw new GoLightError(err.message, err.exitCode ?? 1);
    throw err;
  }
}

export function cmdInit(options, env = process.env) {
  const dir = runDirOf(options);
  const path = statePath(dir);
  if (existsSync(path))
    return { state_path: path, created: false, ...readState(dir) };
  if (!options.request || options.request === true)
    throw new GoLightError("init needs --request <text>", 2);
  const projectDir = projectDirOf(options, null);

  // Freeze the config so the whole task, and an esp-go escalation, use the same settings.
  let snapshot = options["config-snapshot"]
    ? resolve(expandHome(String(options["config-snapshot"])))
    : null;
  if (!snapshot) {
    snapshot = join(dir, "config.snapshot.json");
    if (!existsSync(snapshot)) {
      try {
        writeJson(snapshot, loadConfig({ projectDir }).config);
      } catch (err) {
        if (err instanceof ConfigError)
          throw new GoLightError(err.message, err.exitCode ?? 1);
        throw err;
      }
    }
  }
  const config = configOf(snapshot);
  const light = config["go-light"] ?? {};
  const stopBeforeWait = Boolean(options["stop-before-wait"]);
  const { phases, skipped } = resolvePhases(light.phases ?? PHASES, {
    stopBeforeWait
  });
  const at = now(env).toISOString();
  const state = {
    state_format: STATE_FORMAT,
    workflow: "esp-go-light",
    request: String(options.request).trim(),
    project_dir: projectDir,
    base: options.base ?? config.pr?.base ?? null,
    base_sha:
      options["base-sha"] ?? git(["rev-parse", "HEAD"], projectDir).trim(),
    branch: null,
    commit: null,
    pr: null,
    summary: null,
    created_at: at,
    updated_at: at,
    config_snapshot: snapshot,
    stop_before_wait: stopBeforeWait,
    phases,
    skipped_phases: skipped,
    phase_status: Object.fromEntries(
      PHASES.map((p) => [p, phases.includes(p) ? "pending" : "skipped"])
    ),
    max_files_changed: light.max_files_changed ?? 10,
    escalate_to_go: light.escalate_to_go ?? true,
    max_wall_minutes: light.budgets?.max_wall_minutes ?? null,
    halt_on: config.go?.halt_on ?? HALT_KEYS,
    gate_failures: 0,
    gate_failure_limit: GATE_FAILURE_LIMIT,
    gate_failure_reasons: [],
    gates: {},
    escalation: null,
    halt: null
  };
  const errors = checkState(state);
  if (errors.length > 0)
    throw new GoLightError(`Invalid state:\n  ${errors.join("\n  ")}`);
  withLock(path, () => writeJson(path, state));
  return { state_path: path, created: true, ...state };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function parseJsonOption(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new GoLightError(`--${name}: invalid JSON (${err.message})`, 2);
  }
}

/** Record a phase status and the facts it produced (branch, commit, PR, gates, summary). */
export function cmdPhase(name, options, env = process.env) {
  const dir = runDirOf(options);
  if (!PHASES.includes(name))
    throw new GoLightError(
      `Unknown phase: ${name ?? "(missing)"} (${PHASES.join(", ")})`,
      2
    );
  const status = options.status;
  if (!PHASE_STATUSES.includes(status) || status === "pending")
    throw new GoLightError(
      "--status must be started, done, skipped or failed",
      2
    );
  if (options.commit && !SHA.test(options.commit))
    throw new GoLightError("--commit must be a commit SHA", 2);
  if (options["base-sha"] && !SHA.test(options["base-sha"]))
    throw new GoLightError("--base-sha must be a commit SHA", 2);
  const gates =
    options.gates === undefined
      ? null
      : parseJsonOption(options.gates, "gates");
  const events = [];
  const state = updateState(
    dir,
    (s) => {
      s.phase_status[name] = status;
      if (options.reason)
        s.phase_reasons = { ...s.phase_reasons, [name]: options.reason };
      if (options["base-sha"]) s.base_sha = options["base-sha"];
      if (options.base) s.base = options.base;
      if (options.branch && options.branch !== s.branch) {
        s.branch = options.branch;
        events.push([
          "branch.created",
          { branch: s.branch, base: s.base, base_sha: s.base_sha }
        ]);
      }
      if (options.commit && options.commit !== s.commit) {
        s.commit = options.commit;
        events.push(["commit.created", { commit: s.commit, phase: name }]);
      }
      if (options.pr && options.pr !== s.pr) {
        s.pr = options.pr;
        events.push(["pr.opened", { pr: s.pr, branch: s.branch }]);
      }
      if (options.summary) s.summary = String(options.summary).trim();
      if (gates) s.gates = { ...s.gates, ...gates };
    },
    env
  );
  for (const [type, data] of events) appendEvent(dir, type, data, env);
  const runFields = {};
  if (options.branch) runFields.branch = options.branch;
  if (options.base) runFields.base = options.base;
  if (options.pr) runFields.pr = options.pr;
  if (Object.keys(runFields).length > 0)
    cmdUpdate({ "run-dir": dir, ...runFields }, env);
  return {
    phase: name,
    status,
    next: nextPhase(state),
    phase_status: state.phase_status
  };
}

/** First phase of the resolved list that is still pending or started. */
export function nextPhase(state) {
  return (
    state.phases.find((p) =>
      ["pending", "started"].includes(state.phase_status[p])
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Limits: files changed, gate failures, wall time
// ---------------------------------------------------------------------------

function escalationAction(state) {
  return state.escalate_to_go ? "escalate" : "continue-over-limit";
}

/** Compare the changed files (or an estimate) with go-light.max_files_changed. */
export function scopeCheck(state, files, estimate = null) {
  const count = estimate ?? files.length;
  const exceeded = count > state.max_files_changed;
  return {
    files,
    count: files.length,
    estimate,
    max_files_changed: state.max_files_changed,
    exceeded,
    action: exceeded ? escalationAction(state) : "continue"
  };
}

export function cmdScope(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  let estimate = null;
  if (options.estimate !== undefined) {
    estimate = Number(options.estimate);
    if (!Number.isInteger(estimate) || estimate < 0)
      throw new GoLightError("--estimate must be an integer >= 0", 2);
  }
  const files =
    estimate === null
      ? changedFiles(projectDirOf(options, state), state.base_sha)
      : [];
  return scopeCheck(state, files, estimate);
}

/** Count a gate failure. The second one escalates (or halts when escalation is off). */
export function gateFailureAction(state) {
  if (state.gate_failures < state.gate_failure_limit) return "retry";
  return state.escalate_to_go ? "escalate" : "halt";
}

export function cmdGateFailure(options, env = process.env) {
  const dir = runDirOf(options);
  const state = updateState(
    dir,
    (s) => {
      s.gate_failures += 1;
      if (options.reason)
        s.gate_failure_reasons = [
          ...(s.gate_failure_reasons ?? []),
          String(options.reason)
        ];
    },
    env
  );
  return {
    gate_failures: state.gate_failures,
    limit: state.gate_failure_limit,
    action: gateFailureAction(state)
  };
}

export function budgetCheck(state, at) {
  const elapsed = Math.max(
    0,
    (at.getTime() - Date.parse(state.created_at)) / 60000
  );
  const max = state.max_wall_minutes;
  const exceeded = max !== null && max !== undefined && elapsed > max;
  let action = "continue";
  if (exceeded)
    action = state.halt_on.includes("budget") ? "halt" : "continue-over-budget";
  return {
    elapsed_minutes: Math.round(elapsed * 10) / 10,
    max_wall_minutes: max ?? null,
    exceeded,
    action
  };
}

export function cmdBudget(options, env = process.env) {
  return budgetCheck(readState(runDirOf(options)), now(env));
}

// ---------------------------------------------------------------------------
// Result blocks
// ---------------------------------------------------------------------------

function runJson(dir) {
  return readJson(join(dir, "run.json"));
}

function headOf(projectDir) {
  try {
    return git(["rev-parse", "HEAD"], projectDir).trim();
  } catch {
    return null;
  }
}

function commitsSince(projectDir, base) {
  try {
    return lines(
      git(["log", "--format=%H %s", `${base}..HEAD`], projectDir)
    ).map((line) => {
      const space = line.indexOf(" ");
      return { sha: line.slice(0, space), subject: line.slice(space + 1) };
    });
  } catch {
    return [];
  }
}

function filesSince(projectDir, base) {
  try {
    return lines(git(["diff", "--name-only", `${base}..HEAD`], projectDir));
  } catch {
    return [];
  }
}

function latestStep(steps, pattern) {
  return steps.filter((s) => pattern.test(s.name)).at(-1) ?? null;
}

function pick(object, keys) {
  if (!object) return null;
  return Object.fromEntries(
    keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]])
  );
}

function assertBlock(block) {
  const { valid, errors } = validateArtifact("result", block);
  if (!valid)
    throw new GoLightError(
      `Invalid result block:\n  ${errors.map((e) => `${e.path}: ${e.message}`).join("\n  ")}`
    );
  return block;
}

function baseOutputs(state, dir) {
  return {
    request: state.request,
    branch: state.branch,
    base: state.base,
    base_sha: state.base_sha,
    pr: state.pr,
    phases: state.phase_status,
    gate_failures: state.gate_failures,
    stop_before_wait: state.stop_before_wait,
    state_path: statePath(dir),
    summary_path: join(dir, "summary.md")
  };
}

/** Escalate to esp-go: save the work as a patch, stash it, log the decision, build the block. */
export function cmdEscalate(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const trigger = options.trigger;
  if (!TRIGGERS.includes(trigger))
    throw new GoLightError(
      `--trigger must be one of ${TRIGGERS.join(", ")}`,
      2
    );
  if (!options.reason)
    throw new GoLightError("escalate needs --reason <text>", 2);
  if (state.escalation) {
    throw new GoLightError(
      `Already escalated (${state.escalation.trigger}): ${state.escalation.reason}`
    );
  }
  const projectDir = projectDirOf(options, state);
  const files = changedFiles(projectDir, state.base_sha);
  const patchText = workingPatch(projectDir, state.base_sha);
  let patch = null;
  if (patchText.trim() !== "") {
    patch = join(dir, "escalation.patch");
    writeFileSync(patch, patchText, "utf8");
  }
  let stash = null;
  if (!options["keep-tree"] && isDirty(projectDir)) {
    const message = `esp-go-light escalation ${runJson(dir).id}`;
    git(["stash", "push", "--include-untracked", "-m", message], projectDir);
    stash = message;
  }
  const decision = appendDecision(
    dir,
    {
      phase:
        state.phase_status.implement === "pending" ? "context" : "implement",
      source: trigger === "design" ? "agent" : "policy",
      risk: "medium",
      decision: `Escalate to esp-go (${trigger})`,
      rationale: `Escalate: ${options.reason}`,
      files,
      "x-esp-escalation": trigger
    },
    env
  );
  const escalation = {
    trigger,
    reason: String(options.reason),
    question: options.question ?? null,
    files,
    patch,
    stash,
    commits: commitsSince(projectDir, state.base_sha).map((c) => c.sha),
    decision: decision.id,
    at: now(env).toISOString()
  };
  updateState(
    dir,
    (s) => {
      s.escalation = escalation;
      for (const phase of s.phases)
        if (["pending", "started"].includes(s.phase_status[phase]))
          s.phase_status[phase] = "skipped";
    },
    env
  );
  const fresh = readState(dir);
  return assertBlock({
    contract_version: 1,
    status: "escalate",
    summary: `Escalated to esp-go (${trigger}): ${options.reason}`,
    files_changed: files,
    commit: null,
    pr: state.pr,
    max_risk: runJson(dir).max_risk ?? "medium",
    outputs: {
      ...baseOutputs(fresh, dir),
      escalation,
      next: { skill: "esp-go", run_dir: dir }
    }
  });
}

/** Halt the task under a go.halt_on key: log the Halt decision and build the block. */
export function cmdHalt(options, env = process.env) {
  const dir = runDirOf(options);
  const key = options.key;
  if (!HALT_KEYS.includes(key))
    throw new GoLightError(`--key must be one of ${HALT_KEYS.join(", ")}`, 2);
  if (!options.reason) throw new GoLightError("halt needs --reason <text>", 2);
  const decision = appendDecision(
    dir,
    {
      phase: options.phase ?? "go-light",
      source: "policy",
      risk: "high",
      decision: `Halt the task (${key})`,
      rationale: `Halt: ${key}: ${options.reason}`,
      "x-esp-class": "Halt"
    },
    env
  );
  const state = updateState(
    dir,
    (s) => {
      s.halt = {
        key,
        reason: String(options.reason),
        decision: decision.id,
        at: now(env).toISOString()
      };
      for (const phase of s.phases)
        if (["pending", "started"].includes(s.phase_status[phase]))
          s.phase_status[phase] = "skipped";
    },
    env
  );
  const projectDir = projectDirOf(options, state);
  return assertBlock({
    contract_version: 1,
    status: "halted",
    summary: `Halted (${key}): ${options.reason}`,
    files_changed: filesSince(projectDir, state.base_sha),
    commit: state.commit,
    pr: state.pr,
    max_risk: "high",
    blockers: [`${key}: ${options.reason}`],
    outputs: { ...baseOutputs(state, dir), halt: state.halt }
  });
}

/**
 * Final result block, from the state and the step results of the phase skills
 * (fix-review, await-review, merge). The status follows the last phase that
 * did not end `done`, unless --status overrides it.
 */
export function buildResult(
  dir,
  state,
  {
    status,
    summary,
    projectDir,
    steps = readStepResults(dir),
    runRisk = null
  } = {}
) {
  const merge = latestStep(steps, /^merge$/);
  const fixReview = latestStep(steps, /^fix-review$/);
  const awaitReview = latestStep(steps, /^await-review$/);
  let derived = "done";
  let carrier = null;
  for (const step of [awaitReview, fixReview, merge]) {
    if (step && step.result.status !== "done")
      [derived, carrier] = [step.result.status, step];
  }
  if (merge?.result.status === "merged") [derived, carrier] = ["merged", merge];
  if (state.halt) derived = "halted";
  if (state.escalation) derived = "escalate";
  const finalStatus = status ?? derived;
  const commits = commitsSince(projectDir, state.base_sha);
  const reviewFixCommits = commits.filter(
    (c) =>
      /^fix(\(review\)|\(ci\))?:/.test(c.subject) ||
      c.subject.startsWith("fixup!")
  );
  const discovered = [];
  const seen = new Set();
  for (const { result } of steps) {
    for (const item of result.discovered_items ?? []) {
      const key = `${item.type}:${item.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        discovered.push(item);
      }
    }
  }
  const block = {
    contract_version: 1,
    status: finalStatus,
    summary: summary ?? defaultSummary(finalStatus, state, merge),
    files_changed: filesSince(projectDir, state.base_sha),
    commit: headOf(projectDir),
    pr: state.pr,
    gates: Object.keys(state.gates ?? {}).length > 0 ? state.gates : undefined,
    max_risk: runRisk,
    outputs: {
      ...baseOutputs(state, dir),
      commits: commits.map((c) => c.sha),
      review_fix_commits: reviewFixCommits.length,
      files_count: filesSince(projectDir, state.base_sha).length,
      fix_review: pick(fixReview?.result.outputs, [
        "mode",
        "pr",
        "rounds",
        "fixed",
        "rejected",
        "deferred",
        "open",
        "remaining",
        "exhausted"
      ]),
      merge: pick(merge?.result.outputs, [
        "outcome",
        "merged",
        "method",
        "method_reason",
        "failing"
      ]),
      await_review: pick(awaitReview?.result.outputs, [
        "reviewers",
        "completed",
        "pending"
      ]),
      deferred_phases: state.stop_before_wait
        ? WAIT_PHASES.filter((p) =>
            state.skipped_phases?.[p]?.includes("stop-before-wait")
          )
        : [],
      halt: state.halt ?? undefined,
      escalation: state.escalation ?? undefined
    }
  };
  if (discovered.length > 0) block.discovered_items = discovered;
  if (finalStatus === "awaiting-human" && carrier?.result.needs_input)
    block.needs_input = carrier.result.needs_input;
  if (
    carrier?.result.blockers?.length &&
    !["done", "merged"].includes(finalStatus)
  )
    block.blockers = carrier.result.blockers;
  if (block.gates === undefined) delete block.gates;
  if (block.outputs.halt === undefined) delete block.outputs.halt;
  if (block.outputs.escalation === undefined) delete block.outputs.escalation;
  return assertBlock(block);
}

function defaultSummary(status, state, merge) {
  const pr = state.pr ? ` ${state.pr}` : "";
  switch (status) {
    case "merged":
      return `Merged${pr} with ${merge?.result.outputs?.method ?? "the resolved method"}.`;
    case "done":
      if (state.stop_before_wait && state.pr)
        return `Opened${pr}; review, fixes and merge are left to the caller.`;
      return state.pr
        ? `Done${pr}.`
        : `Committed ${state.commit ? state.commit.slice(0, 7) : "the change"} on ${state.branch ?? "the branch"}.`;
    case "halted":
      return `Halted${state.halt ? ` (${state.halt.key}): ${state.halt.reason}` : "."}`;
    case "escalate":
      return `Escalated to esp-go (${state.escalation?.trigger}).`;
    case "awaiting-human":
      return `Waiting for a human${pr}.`;
    default:
      return `Failed${pr}.`;
  }
}

export function cmdResult(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  if (options.status !== undefined) {
    const statuses = [
      "done",
      "merged",
      "halted",
      "awaiting-human",
      "failed",
      "escalate"
    ];
    if (!statuses.includes(options.status))
      throw new GoLightError(
        `--status must be one of ${statuses.join(", ")}`,
        2
      );
  }
  return buildResult(dir, state, {
    status: options.status,
    summary: options.summary,
    projectDir: projectDirOf(options, state),
    runRisk: runJson(dir).max_risk ?? null
  });
}

// ---------------------------------------------------------------------------
// Pull request body
// ---------------------------------------------------------------------------

export function cmdPrBody(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const config = configOf(state.config_snapshot);
  const summary = options.summary ?? state.summary ?? state.request;
  const sections = config.pr?.body_sections ?? BODY_SECTIONS;
  const attribution =
    config.pr?.attribution === false
      ? null
      : (options.attribution ?? ATTRIBUTION);
  const body = renderPrBody(collectRunArtifacts(dir), {
    summary,
    sections,
    attribution
  });
  if (options.out) {
    writeFileSync(resolve(String(options.out)), body, "utf8");
    return {
      path: resolve(String(options.out)),
      bytes: Buffer.byteLength(body)
    };
  }
  return body;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node go-light.mjs <command> [args] --run-dir <path> [options]

Commands:
  init                 Create go-light.json (--request <text>); resolves the phases and freezes
                       the config in config.snapshot.json. A second call prints the state
  show                 Print go-light.json
  phase <name>         Record a phase: --status started|done|skipped|failed, and the facts it
                       produced (--branch, --base, --base-sha, --commit, --pr, --summary, --gates)
  scope                Changed files since the base vs go-light.max_files_changed
                       (--estimate <n> checks a planned file count instead)
  gate-failure         Count a gate failure (--reason); the second escalates, or halts
  budget               Elapsed wall time vs go-light.budgets.max_wall_minutes
  escalate             Hand the task to esp-go (--trigger files|design|gates --reason <text>
                       [--question <text>] [--keep-tree]): saves escalation.patch, stashes the
                       work, logs the decision, prints the escalate result block (exit 30)
  halt                 Halt under a go.halt_on key (--key <key> --reason <text>), logs the
                       Halt decision, prints the halted result block (exit 20)
  pr-body              Pull request body from the run artifacts (--summary <text>, --out <file>)
  result               Final result block (--status, --summary); exits with its contract code

Options:
  --run-dir <path>          Run directory (required)
  --config-snapshot <path>  Config snapshot (init; later commands use the frozen one)
  --project-dir <dir>       Repository root (default: recorded at init, else the git root)
  --stop-before-wait        init: leave await-review, fix-review and merge to the caller
  --help                    Show this help`;

const BOOLEAN_FLAGS = new Set(["stop-before-wait", "keep-tree", "help"]);

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
          throw new GoLightError(`--${key} requires a value`, 2);
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
    case "show":
      return { output: readState(runDirOf(options)) };
    case "phase":
      return { output: cmdPhase(args[0], options, env) };
    case "scope":
      return { output: cmdScope(options) };
    case "gate-failure":
      return { output: cmdGateFailure(options, env) };
    case "budget":
      return { output: cmdBudget(options, env) };
    case "escalate": {
      const block = cmdEscalate(options, env);
      return {
        output: JSON.stringify(block),
        exitCode: exitCodeFor(block.status)
      };
    }
    case "halt": {
      const block = cmdHalt(options, env);
      return {
        output: JSON.stringify(block),
        exitCode: exitCodeFor(block.status)
      };
    }
    case "pr-body":
      return { output: cmdPrBody(options) };
    case "result": {
      const block = cmdResult(options);
      return {
        output: JSON.stringify(block),
        exitCode: exitCodeFor(block.status)
      };
    }
    default:
      throw new GoLightError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = ["GoLightError", "RunsError", "LockTimeoutError"].includes(
      err.name
    );
    process.stderr.write(
      `go-light error: ${known ? err.message : (err.stack ?? err)}\n`
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
