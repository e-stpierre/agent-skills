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

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expandHome } from "../../config.mjs";
import { withLock } from "../lock.mjs";
import { filesOverlap, planBatches, readPlan, wholeRepo } from "../../plan.mjs";
import { appendDecision, appendEvent, latestPlan, now } from "../../runs.mjs";
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
    throw new ShipError(
      `No state.json in ${dir}: run "ship.mjs milestone init" first`
    );
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
  const config = configOf(snapshot);
  const settings = shipSettings(config);
  const root = worktreeRoot(config);

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
    const batches = planBatches(plan, {
      maxParallel: settings.max_parallel,
      done: Object.keys(state.milestones).filter(
        (id) => state.milestones[id].status === "done"
      )
    });
    const parallel = parallelDecision({
      mode: settings.parallel,
      batches,
      root,
      rootUsable: worktreeRootUsable(root)
    });
    Object.assign(state, {
      plan_path: planFile,
      plan_version: plan.version,
      config_snapshot: snapshot,
      max_retries: settings.max_retries_per_milestone,
      parallel: parallel.enabled,
      parallel_mode: settings.parallel,
      parallel_reason: parallel.reason,
      max_parallel: settings.max_parallel,
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
      config_snapshot: snapshot,
      parallel: {
        mode: settings.parallel,
        enabled: parallel.enabled,
        reason: parallel.reason,
        max_parallel: settings.max_parallel,
        worktrees_root: root,
        batches: batches.summary
      }
    };
  });
}

// ---------------------------------------------------------------------------
// parallel: whether the build runs batches of milestones in worktrees
// ---------------------------------------------------------------------------

export const PARALLEL_MODES = ["auto", "on", "off"];

const worktreeRoot = (config) =>
  resolve(
    expandHome(String(config.worktrees?.root ?? "~/.esp-skills/worktrees"))
  );

/**
 * True when `root` is a writable directory, or can be created under its
 * nearest existing ancestor, which must be a writable directory.
 */
export function worktreeRootUsable(root) {
  let dir = resolve(root);
  for (;;) {
    if (existsSync(dir)) {
      try {
        if (!statSync(dir).isDirectory()) return false;
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Resolve `ship.parallel` for a plan (pure). `on` and `off` are taken as
 * they are. `auto` is on only when `planBatches` found a batch of two or
 * more milestones and the worktree root is usable.
 */
export function parallelDecision({ mode = "auto", batches, root, rootUsable }) {
  if (!PARALLEL_MODES.includes(mode))
    throw new ShipError(
      `ship.parallel must be one of ${PARALLEL_MODES.join(", ")}`,
      2
    );
  if (mode !== "auto")
    return { enabled: mode === "on", reason: `ship.parallel is ${mode}` };
  if (!batches?.parallel)
    return {
      enabled: false,
      reason: "auto: no batch of two or more milestones with disjoint files"
    };
  if (!rootUsable)
    return {
      enabled: false,
      reason: `auto: worktrees.root is not usable (${root})`
    };
  return {
    enabled: true,
    reason: `auto: the plan has a batch of ${batches.max_batch} milestones`
  };
}

// ---------------------------------------------------------------------------
// next: the milestone (or parallel batch) to run now
// ---------------------------------------------------------------------------

// filesOverlap lives in plan.mjs (plan batches and lint share it).
export { filesOverlap };

/**
 * Decide what runs next. Returns `{ action, milestone, batch, attempt, amend, ... }`:
 * - `run`: start `milestone` (attempt 1) or the whole `batch` (parallel: at
 *   most `state.max_parallel` runnable milestones with disjoint files; one
 *   without files, or covering the whole repository, always runs alone)
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
  const alone = (id) => ms[id].files.length === 0 || wholeRepo(ms[id].files);
  const cap = Math.max(1, state.max_parallel ?? Infinity);
  // Single Milestone Mode (only) never batches.
  if (parallel && !only && !alone(batch[0])) {
    for (const id of runnable.slice(1)) {
      if (batch.length >= cap) break;
      if (alone(id)) continue;
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
      // A retry with no commit to amend starts from the new HEAD (for example
      // after a parallel batch was cherry-picked), so its base moves with it.
      if (m.base === null || (m.commit === null && options.base))
        m.base = options.base ?? m.base;
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
        throw new ShipError("--commit <sha> is required with --status done", 2);
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

// ---------------------------------------------------------------------------
// reuse: continue the last builder with the next milestone, or spawn a fresh one
// ---------------------------------------------------------------------------

export const REUSE_DEFAULTS = {
  limit_tokens: 250000,
  cost: { low: 40000, medium: 70000, high: 120000 }
};

const reuseSettings = (config) => {
  const reuse = config.ship?.reuse ?? {};
  return {
    limit: reuse.limit_tokens ?? REUSE_DEFAULTS.limit_tokens,
    cost: { ...REUSE_DEFAULTS.cost, ...(reuse.cost ?? {}) }
  };
};

const costOf = (cost, complexity) =>
  cost[complexity] ?? cost.medium ?? REUSE_DEFAULTS.cost.medium;

const modelLabel = (m) => (m.effort ? `${m.model}:${m.effort}` : m.model);
const sameModel = (a, b) =>
  a.model === b.model && (a.effort ?? null) === (b.effort ?? null);

/**
 * Estimated context of a builder: the real usage when an Agent result
 * reported it, else the sum of the complexity costs of the work it ran.
 */
export function builderUsed(builder, cost) {
  const runs = builder?.runs ?? [];
  if (Number.isInteger(builder?.tokens)) {
    // Runs continued after the last reported usage add their estimate.
    const after = runs.slice(builder.tokens_runs ?? runs.length);
    return after.reduce(
      (sum, r) => sum + costOf(cost, r.complexity),
      builder.tokens
    );
  }
  return runs.reduce(
    (sum, r) => sum + costOf(cost, r.complexity),
    0
  );
}

function builderModel(state, m, options) {
  const model = stringOption(options.model);
  if (model && !MODEL_ALIASES.has(model))
    throw new ShipError(
      `--model must be one of ${[...MODEL_ALIASES].join(", ")}`,
      2
    );
  const { builder } = resolveModels(
    configOf(state.config_snapshot),
    m.complexity,
    { model, effort: stringOption(options.effort) }
  );
  return builder.effort
    ? { model: builder.model, effort: builder.effort }
    : { model: builder.model };
}

/**
 * Decide whether the last builder continues with milestone `id` (pure).
 * Reuse only when every rule holds, in this order: not --milestone mode, a
 * builder ran in the main tree, `id` does not run in a parallel batch, this
 * session still holds the builder's agent ID, `id` is a retry of that builder
 * or depends on / shares files with a milestone it ran, the builder model and
 * effort of `id` equal the builder's, and `used + cost(id) <= limit`.
 */
export function reuseDecision({
  state,
  id,
  model,
  agentId = null,
  single = false,
  batch = [],
  limit = REUSE_DEFAULTS.limit_tokens,
  cost = REUSE_DEFAULTS.cost
}) {
  const ms = state.milestones;
  const m = ms[id];
  const builder = state.builder ?? null;
  const used = builder ? builderUsed(builder, cost) : 0;
  const next = costOf(cost, m.complexity);
  const facts = {
    milestone: id,
    model,
    used,
    cost: next,
    limit,
    builder_agent_id: builder?.agent_id ?? null
  };
  const fresh = (reason) => ({
    ...facts,
    decision: "fresh",
    agent_id: null,
    reason
  });
  if (single) return fresh("--milestone mode always spawns a fresh builder");
  if (!builder) return fresh("no builder ran before this milestone");
  if (builder.worktree)
    return fresh("the last builder ran in a worktree of a parallel batch");
  if (batch.length > 1 && batch.includes(id))
    return fresh(`${id} runs in the parallel batch ${batch.join(" + ")}`);
  if (!agentId)
    return fresh(
      "this session holds no builder agent ID (resumed run or lost ID)"
    );
  if (agentId !== builder.agent_id)
    return fresh(
      `agent ${agentId} is not the last builder (${builder.agent_id})`
    );
  const ran = [...new Set(builder.runs.map((r) => r.milestone))];
  const last = builder.runs.at(-1)?.milestone;
  let relevance = null;
  if (last === id && ["in-progress", "failed"].includes(m.status))
    relevance = `retry of ${id}`;
  else {
    const dep = ran.find((r) => m.depends.includes(r));
    const shared = ran.find((r) => filesOverlap(ms[r]?.files ?? [], m.files));
    if (dep) relevance = `${id} depends on ${dep}`;
    else if (shared) relevance = `${id} shares files with ${shared}`;
  }
  if (!relevance)
    return fresh(
      `${id} neither depends on nor shares files with ${ran.join(", ")}`
    );
  const current = { model: builder.model, effort: builder.effort };
  if (!sameModel(model, current))
    return fresh(
      `model mismatch: ${id} needs ${modelLabel(model)}, the builder runs ${modelLabel(current)}`
    );
  if (used + next > limit)
    return fresh(
      `context budget: ${used} used + ${next} for ${id} > ${limit} limit_tokens`
    );
  return {
    ...facts,
    decision: "reuse",
    agent_id: builder.agent_id,
    reason: `${relevance}; ${used} used + ${next} <= ${limit}`
  };
}

export function cmdReuse(id, options, env = process.env) {
  const dir = runDirOf(options);
  const state = readMilestoneState(dir);
  const m = milestoneOf(state, id);
  if (m.status === "done" || m.status === "halted")
    throw new ShipError(`${id} is ${m.status}; nothing to build`, 2);
  const { limit, cost } = reuseSettings(configOf(state.config_snapshot));
  const next = nextStep(state, {
    parallel: options.parallel === true || state.parallel === true
  });
  const gate = reuseDecision({
    state,
    id,
    model: builderModel(state, m, options),
    agentId: stringOption(options["agent-id"]),
    single: options.single === true,
    batch: ["run", "retry"].includes(next.action) ? next.batch : [],
    limit,
    cost
  });
  const decision = appendDecision(
    dir,
    {
      phase: "build",
      source: "policy",
      risk: "low",
      decision:
        gate.decision === "reuse"
          ? `Continue the builder with ${id}`
          : `Spawn a fresh builder for ${id}`,
      rationale: gate.reason,
      refs: [id],
      "x-esp-builder-reuse": {
        agent_id: gate.agent_id ?? gate.builder_agent_id,
        model: modelLabel(gate.model),
        used: gate.used,
        cost: gate.cost,
        limit: gate.limit
      }
    },
    env
  );
  const result = { ...gate, decision_id: decision.id };
  updateState(
    dir,
    (s) => {
      s.milestones[id].reuse = {
        decision: gate.decision,
        reason: gate.reason,
        decision_id: decision.id
      };
    },
    env
  );
  return result;
}

/**
 * Record the builder agent that ran (an attempt of) milestone `id`: the same
 * agent ID as the last builder continues it, any other starts a new one.
 * `--tokens` is the usage the Agent result reported, which replaces the
 * estimate. `--worktree` marks a builder of a parallel batch: it never
 * continues.
 */
export function cmdAgent(id, options, env = process.env) {
  const dir = runDirOf(options);
  const agentId = stringOption(options["agent-id"]);
  if (!agentId) throw new ShipError("--agent-id <id> is required", 2);
  let tokens = null;
  if (options.tokens !== undefined) {
    tokens = Number(options.tokens);
    if (!Number.isInteger(tokens) || tokens < 0)
      throw new ShipError("--tokens must be an integer >= 0", 2);
  }
  const worktree = options.worktree === true;
  return updateState(
    dir,
    (state) => {
      const m = milestoneOf(state, id);
      const model = builderModel(state, m, options);
      const { cost } = reuseSettings(configOf(state.config_snapshot));
      const prev = state.builder ?? null;
      const continued =
        !worktree && !prev?.worktree && prev?.agent_id === agentId;
      const builder = continued
        ? prev
        : {
            agent_id: agentId,
            ...model,
            worktree,
            runs: [],
            tokens: null
          };
      builder.runs.push({
        milestone: id,
        attempt: m.attempts,
        complexity: m.complexity
      });
      if (tokens !== null) {
        builder.tokens = tokens;
        builder.tokens_runs = builder.runs.length;
      }
      state.builder = builder;
      m.builder = {
        agent_id: agentId,
        ...model,
        attempt: m.attempts,
        continued,
        worktree
      };
      return {
        milestone: id,
        agent_id: agentId,
        continued,
        worktree,
        runs: builder.runs.map((r) => r.milestone),
        used: builderUsed(builder, cost),
        tokens_source: Number.isInteger(builder.tokens)
          ? "reported"
          : "estimate"
      };
    },
    env
  );
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
