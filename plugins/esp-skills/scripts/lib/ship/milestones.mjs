// Milestone state of the orchestrated track (`<run-dir>/state.json`).
//
// Keeps the milestone loop deterministic: which milestone (or parallel batch)
// runs next, how many attempts it had, which commit it produced, and which
// model its builder and verifier use. The esp-ship main session calls
// `ship.mjs milestone <cmd>` between builder and verifier spawns, so no
// SKILL.md writes state.json by hand.
//
// state.json is not a contract artifact: the contract only reserves its name.
// Its `milestones.<id>.status` values are read by plan.mjs (`completedFromState`)
// and by esp-plan --amend, so `done` must keep its meaning.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome } from "../../config.mjs";
import { withLock } from "../lock.mjs";
import { readPlan } from "../../plan.mjs";
import { appendEvent, latestPlan, now } from "../../runs.mjs";
import { gatesFor } from "./gates.mjs";
import {
  configOf,
  freezeConfig,
  readJson,
  runDirOf,
  SHA,
  ShipError,
  shipSettings,
  statePath as shipStatePath,
  stringOption,
  writeJson
} from "./state.mjs";

export const STATE_FORMAT = 1;
export const MILESTONE_STATUSES = [
  "pending",
  "in-progress",
  "failed",
  "done",
  "halted"
];
const MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

const statePath = (dir) => join(dir, "state.json");

export function readMilestoneState(dir) {
  const path = statePath(dir);
  if (!existsSync(path))
    throw new ShipError(`No state.json in ${dir}: run "ship.mjs milestone init" first`);
  const state = readJson(path);
  const errors = checkMilestoneState(state);
  if (errors.length > 0)
    throw new ShipError(`Invalid ${path}:\n  ${errors.join("\n  ")}`);
  return state;
}

/** Structural check of a state object; returns a list of error strings. */
export function checkMilestoneState(state) {
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
    const state = readMilestoneState(dir);
    const result = fn(state);
    state.updated_at = now(env).toISOString();
    const errors = checkMilestoneState(state);
    if (errors.length > 0)
      throw new ShipError(
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

export function cmdMilestoneInit(options, env = process.env) {
  const dir = runDirOf(options);
  const planFile = stringOption(options.plan)
    ? resolve(expandHome(String(options.plan)))
    : (latestPlan(dir).path ?? shipPlanPath(dir));
  if (!planFile)
    throw new ShipError(
      `No plan in ${dir}: pass --plan <file> or run esp-plan first`
    );
  const { plan, errors } = readPlan(planFile);
  if (errors.length > 0)
    throw new ShipError(
      `Plan does not lint (${planFile}):\n  ${errors.join("\n  ")}`
    );
  if (plan.milestones.length === 0)
    throw new ShipError(`Plan has no milestones: ${planFile}`);

  // Freeze the config for deterministic resume: an explicit snapshot wins,
  // then the one of state.json, then the one of ship.json, else the merged
  // config is written in the run directory once.
  const path = statePath(dir);
  const existing = existsSync(path) ? readMilestoneState(dir) : null;
  const snapshot = freezeConfig(dir, {
    snapshot:
      stringOption(options["config-snapshot"]) ??
      existing?.config_snapshot ??
      shipSnapshot(dir),
    projectDir: stringOption(options["project-dir"]) ?? undefined
  });
  const settings = shipSettings(configOf(snapshot));

  return withLock(path, () => {
    const at = now(env).toISOString();
    const current = existsSync(path) ? readMilestoneState(dir) : null;
    const state = current ?? {
      state_format: STATE_FORMAT,
      workflow: "esp-ship",
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
        throw new ShipError(
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
      max_retries: settings.max_retries_per_milestone,
      parallel: settings.parallel,
      commit_per_milestone: settings.commit_per_milestone,
      order: plan.milestones.map((m) => m.id),
      updated_at: at
    });
    if (options.base && !state.base) state.base = options.base;
    const errs = checkMilestoneState(state);
    if (errs.length > 0)
      throw new ShipError(
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
        reason: `gates still failing after ${m.attempts} attempts (max_retries_per_milestone: ${state.max_retries})`
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
    if (!ms[only]) throw new ShipError(`Unknown milestone: ${only}`, 2);
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

export function cmdMilestoneNext(options) {
  const dir = runDirOf(options);
  const state = readMilestoneState(dir);
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
  if (!id) throw new ShipError("A milestone ID is required", 2);
  const m = state.milestones[id];
  if (!m) throw new ShipError(`Unknown milestone: ${id}`, 2);
  return m;
}

export function cmdStart(id, options, env = process.env) {
  const dir = runDirOf(options);
  const entry = updateState(
    dir,
    (state) => {
      const m = milestoneOf(state, id);
      if (m.status === "done" || m.status === "halted")
        throw new ShipError(`${id} is ${m.status}; it cannot start again`);
      if (m.attempts >= 1 + state.max_retries)
        throw new ShipError(`${id} has no attempts left (${m.attempts})`);
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
    throw new ShipError("--status must be done, failed or halted", 2);
  const commit =
    options.commit && options.commit !== true ? String(options.commit) : null;
  if (commit && !SHA.test(commit))
    throw new ShipError(`--commit must be a commit SHA, got ${commit}`, 2);
  const entry = updateState(
    dir,
    (state) => {
      const m = milestoneOf(state, id);
      // A failed milestone can be marked halted (retries exhausted) without a new attempt.
      const haltFailed = status === "halted" && m.status === "failed";
      if (m.status !== "in-progress" && !haltFailed)
        throw new ShipError(
          `${id} is ${m.status}, not in-progress: run "start ${id}" first`
        );
      if (status === "done" && !commit && !m.commit)
        throw new ShipError(
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
  const state = readMilestoneState(dir);
  const m = milestoneOf(state, id);
  const model =
    options.model && options.model !== true ? String(options.model) : null;
  if (model && !MODEL_ALIASES.has(model))
    throw new ShipError(
      `--model must be one of ${[...MODEL_ALIASES].join(", ")}`,
      2
    );
  const config = configOf(state.config_snapshot);
  return {
    milestone: id,
    complexity: m.complexity,
    ...resolveModels(config, m.complexity, { model, effort: options.effort })
  };
}

/** The plan and the config snapshot recorded in ship.json, when the run has one. */
function shipJson(dir) {
  const path = shipStatePath(dir);
  return existsSync(path) ? readJson(path) : null;
}
const shipPlanPath = (dir) => shipJson(dir)?.plan_path ?? null;
const shipSnapshot = (dir) => shipJson(dir)?.config_snapshot ?? null;

export function cmdMilestoneGates(options) {
  let snapshot = stringOption(options["config-snapshot"]) ?? undefined;
  let planPath = stringOption(options.plan);
  planPath = planPath ? resolve(expandHome(planPath)) : null;
  if (options["run-dir"]) {
    const dir = runDirOf(options);
    const milestoneState = existsSync(statePath(dir))
      ? readMilestoneState(dir)
      : null;
    snapshot ??=
      milestoneState?.config_snapshot ?? shipSnapshot(dir) ?? undefined;
    planPath ??= milestoneState?.plan_path ?? shipPlanPath(dir);
  }
  return gatesFor({
    projectDir: options["project-dir"],
    snapshot,
    scope: options.scope,
    milestone: options.milestone,
    files: options.files,
    planPath
  });
}
