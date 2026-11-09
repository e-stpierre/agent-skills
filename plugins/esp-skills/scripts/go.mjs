#!/usr/bin/env node
// esp-skills state and dispatch for esp-go.
//
// esp-go takes a feature from request to merged pull request. The skill runs
// each phase in its own subagent and keeps only result blocks; this script
// keeps everything deterministic out of the model: the phase list and what to
// run next (with the role model of the phase subagent), the internal review
// loop bounded by go.internal_review_rounds, the pull request round loop, the
// budgets, the hand-off from an escalated esp-go-light run, the task worktree,
// the pull request body built from the run artifacts, and the final result
// block. State lives in <run-dir>/go.json, so an interrupted run resumes.
//
// Exit codes: 0 ok, 1 failure or invalid state, 2 usage. `halt` and `result`
// exit with the contract code of their result status (0 done or merged,
// 10 awaiting-human, 20 halted, 1 failed).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  expandHome,
  findRepoRoot,
  loadConfig
} from "./config.mjs";
import { git } from "./go-light.mjs";
import { exitCodeFor, validateArtifact } from "./lib/contract.mjs";
import { withLock } from "./lib/lock.mjs";
import {
  ATTRIBUTION,
  BODY_SECTIONS,
  collectRunArtifacts,
  readStepResults,
  renderPrBody
} from "./lib/pr-body.mjs";
import { readPlan } from "./plan.mjs";
import { appendDecision, appendEvent, cmdUpdate, now } from "./runs.mjs";

export class GoError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "GoError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
export const PHASES = [
  "plan",
  "branch",
  "build",
  "review",
  "pr",
  "await-review",
  "fix-review",
  "merge"
];
export const PR_PHASES = ["await-review", "fix-review", "merge"];
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

/**
 * Role of each phase subagent, resolved through defaults.models.<role>.
 * await-review runs in the orchestrator: its background wait wakes the main
 * session, and it keeps only the result line.
 */
export const PHASE_ROLES = {
  plan: "planner",
  branch: "mechanical",
  build: "verifier",
  review: "reviewer",
  "review-fix": "fixer",
  pr: "mechanical",
  "await-review": null,
  "fix-review": "fixer",
  merge: "fixer"
};
const SKILLS = {
  plan: "esp-plan",
  branch: "esp-branch",
  build: "esp-build",
  review: "esp-review",
  "review-fix": "esp-fix-review",
  pr: "esp-pr",
  "await-review": "esp-await-review",
  "fix-review": "esp-fix-review",
  merge: "esp-merge"
};
const SHA = /^[0-9a-f]{7,64}$/;
const FINISHED = new Set(["done", "merged"]);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new GoError(
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
  if (!options["run-dir"]) throw new GoError("--run-dir <path> is required", 2);
  const dir = resolve(expandHome(String(options["run-dir"])));
  if (!existsSync(join(dir, "run.json")))
    throw new GoError(`Not a run directory (no run.json): ${dir}`);
  return dir;
}

const runJson = (dir) => readJson(join(dir, "run.json"));
const statePath = (dir) => join(dir, "go.json");

function configOf(snapshot) {
  try {
    return loadConfig({ snapshot }).config;
  } catch (err) {
    if (err instanceof ConfigError)
      throw new GoError(err.message, err.exitCode ?? 1);
    throw err;
  }
}

function positiveInt(raw, name, min = 1) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min)
    throw new GoError(`--${name} must be an integer >= ${min}`, 2);
  return n;
}

const lines = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

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
  if (!INTERACTIVE_MODES.includes(state?.interactive))
    errors.push(`interactive: expected one of ${INTERACTIVE_MODES.join(", ")}`);
  if (
    !Number.isInteger(state?.internal_review_rounds) ||
    state.internal_review_rounds < 0
  )
    errors.push("internal_review_rounds: expected an integer >= 0");
  if (!Number.isInteger(state?.pr_rounds?.max) || state.pr_rounds.max < 1)
    errors.push("pr_rounds.max: expected an integer >= 1");
  if (state?.base_sha && !SHA.test(state.base_sha))
    errors.push("base_sha: expected a commit SHA");
  return errors;
}

export function readState(dir) {
  const path = statePath(dir);
  if (!existsSync(path))
    throw new GoError(`No go.json in ${dir}: run "go.mjs init" first`);
  const state = readJson(path);
  const errors = checkState(state);
  if (errors.length > 0)
    throw new GoError(`Invalid ${path}:\n  ${errors.join("\n  ")}`);
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
      throw new GoError(
        `Refusing to write invalid state:\n  ${errors.join("\n  ")}`
      );
    writeJson(path, state);
    return result ?? state;
  });
}

/**
 * Phases to run, in canonical order, from go.phases and the flags. `build` is
 * required. --no-pr drops the pull request and its wait phases, --no-merge
 * drops the merge, and go.internal_review_rounds 0 drops the internal review.
 */
export function resolvePhases(
  configured = PHASES,
  { noPr = false, noMerge = false, reviewRounds = 2 } = {}
) {
  const wanted = new Set(configured);
  if (!wanted.has("build"))
    throw new GoError("go.phases must include build", 1);
  const phases = [];
  const skipped = {};
  for (const phase of PHASES) {
    if (!wanted.has(phase)) skipped[phase] = "not in go.phases";
    else if (phase === "review" && reviewRounds === 0)
      skipped[phase] = "go.internal_review_rounds is 0";
    else if (phase === "pr" && noPr) skipped[phase] = "--no-pr";
    else if (PR_PHASES.includes(phase) && (noPr || !wanted.has("pr")))
      skipped[phase] = noPr ? "--no-pr" : "needs the pr phase";
    else if (phase === "merge" && noMerge) skipped[phase] = "--no-merge";
    else phases.push(phase);
  }
  return { phases, skipped };
}

/** The escalation hand-off of an esp-go-light run in the same run directory, if any. */
export function findEscalation(dir) {
  const step = readStepResults(dir)
    .filter((s) => s.name === "go-light")
    .at(-1);
  if (step?.result.status !== "escalate" || !step.result.outputs?.escalation)
    return null;
  const o = step.result.outputs;
  let request = o.request ?? null;
  let snapshot = null;
  if (existsSync(join(dir, "go-light.json"))) {
    const light = readJson(join(dir, "go-light.json"));
    request ??= light.request;
    snapshot = light.config_snapshot ?? null;
  }
  return {
    ...o.escalation,
    request,
    branch: o.branch ?? null,
    base: o.base ?? null,
    base_sha: o.base_sha ?? null,
    config_snapshot: snapshot,
    step: step.step
  };
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

export function cmdInit(options, env = process.env) {
  const dir = runDirOf(options);
  const path = statePath(dir);
  if (existsSync(path))
    return { state_path: path, created: false, ...readState(dir) };
  const escalation = findEscalation(dir);
  const request =
    options.request && options.request !== true
      ? String(options.request).trim()
      : escalation?.request;
  if (!request)
    throw new GoError(
      "init needs --request <text> (or a run escalated by esp-go-light)",
      2
    );
  const projectDir = projectDirOf(options, null);

  // Freeze the config: an explicit snapshot wins, then the escalated run's, then a new one.
  let snapshot = options["config-snapshot"]
    ? resolve(expandHome(String(options["config-snapshot"])))
    : (escalation?.config_snapshot ?? null);
  if (!snapshot) {
    snapshot = join(dir, "config.snapshot.json");
    if (!existsSync(snapshot)) {
      try {
        writeJson(snapshot, loadConfig({ projectDir }).config);
      } catch (err) {
        if (err instanceof ConfigError)
          throw new GoError(err.message, err.exitCode ?? 1);
        throw err;
      }
    }
  }
  const config = configOf(snapshot);
  const go = config.go ?? {};
  const reviewRounds = go.internal_review_rounds ?? 2;
  const { phases, skipped } = resolvePhases(go.phases ?? PHASES, {
    noPr: Boolean(options["no-pr"]),
    noMerge: Boolean(options["no-merge"]),
    reviewRounds
  });
  const interactive =
    options.interactive ?? config.defaults?.interactive ?? "off";
  if (!INTERACTIVE_MODES.includes(interactive))
    throw new GoError(
      `--interactive must be one of ${INTERACTIVE_MODES.join(", ")}`,
      2
    );
  const at = now(env).toISOString();
  const state = {
    state_format: STATE_FORMAT,
    workflow: "esp-go",
    request,
    project_dir: projectDir,
    repo_dir: projectDir,
    base: options.base ?? escalation?.base ?? config.pr?.base ?? null,
    base_sha:
      options["base-sha"] ??
      escalation?.base_sha ??
      git(["rev-parse", "HEAD"], projectDir).trim(),
    branch: escalation?.branch ?? null,
    worktree: null,
    use_worktree:
      options.worktree === undefined
        ? Boolean(go.worktree)
        : Boolean(options.worktree),
    plan_path: null,
    plan_title: null,
    milestones: null,
    pr: null,
    summary: null,
    interactive,
    reviewers:
      options.reviewers && options.reviewers !== true
        ? String(options.reviewers)
        : null,
    created_at: at,
    updated_at: at,
    config_snapshot: snapshot,
    phases,
    skipped_phases: skipped,
    phase_status: Object.fromEntries(
      PHASES.map((p) => [p, phases.includes(p) ? "pending" : "skipped"])
    ),
    internal_review_rounds: reviewRounds,
    pr_rounds: {
      max:
        options["max-rounds"] !== undefined
          ? positiveInt(options["max-rounds"], "max-rounds")
          : (config["fix-review"]?.max_rounds ?? 3),
      done: 0,
      commits: 0
    },
    pr_draft_until_reviewed: go.pr_draft_until_reviewed ?? true,
    max_milestones: go.budgets?.max_milestones ?? null,
    max_wall_minutes: go.budgets?.max_wall_minutes ?? null,
    halt_on: go.halt_on ?? HALT_KEYS,
    escalated_from: escalation
      ? {
          step: escalation.step,
          trigger: escalation.trigger,
          reason: escalation.reason,
          files: escalation.files ?? [],
          patch: escalation.patch ?? null,
          stash: escalation.stash ?? null
        }
      : null,
    stop: null,
    halt: null
  };
  const errors = checkState(state);
  if (errors.length > 0)
    throw new GoError(`Invalid state:\n  ${errors.join("\n  ")}`);
  withLock(path, () => writeJson(path, state));
  if (escalation) {
    // The go-light run ended halted; esp-go takes the task over in the same run.
    cmdUpdate({ "run-dir": dir, status: "running" }, env);
    appendEvent(
      dir,
      "run.resumed",
      { by: "esp-go", from: "esp-go-light", trigger: escalation.trigger },
      env
    );
  }
  return { state_path: path, created: true, ...state };
}

// ---------------------------------------------------------------------------
// Phases and dispatch
// ---------------------------------------------------------------------------

/** Role model of a phase subagent from defaults.models.<role>; null runs in the orchestrator. */
export function phaseModel(config, phase) {
  const role = PHASE_ROLES[phase];
  if (!role) return { role: null, model: null };
  const entry = config.defaults?.models?.[role];
  if (!entry?.model) return { role, model: "inherit" };
  return entry.effort
    ? { role, model: entry.model, effort: entry.effort }
    : { role, model: entry.model };
}

export function nextPhase(state) {
  return (
    state.phases.find((p) =>
      ["pending", "started"].includes(state.phase_status[p])
    ) ?? null
  );
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

/** What the orchestrator runs now: the phase, its subagent model, and what it needs. */
export function dispatch(dir, state, at, config) {
  if (state.halt)
    return { action: "result", reason: `halted (${state.halt.key})` };
  if (state.stop)
    return { action: "result", reason: `stopped: ${state.stop.reason}` };
  const budget = budgetCheck(state, at);
  if (budget.action === "halt")
    return {
      action: "halt",
      key: "budget",
      reason: `wall time ${budget.elapsed_minutes} min over ${budget.max_wall_minutes}`,
      budget
    };
  const phase = nextPhase(state);
  if (!phase)
    return { action: "result", reason: "every phase is done or skipped" };
  const cwd = state.worktree ?? state.project_dir;
  const out = {
    action: "run",
    phase,
    resumed: state.phase_status[phase] === "started",
    cwd,
    budget
  };
  if (phase === "review") {
    const loop = reviewLoop(dir, state);
    if (loop.action === "done")
      return { ...out, action: "complete", phase, loop, reason: loop.reason };
    if (loop.action === "halt")
      return {
        ...out,
        action: "halt",
        key: loop.key,
        reason: loop.reason,
        loop
      };
    if (loop.action === "stop")
      return {
        ...out,
        action: "stop",
        status: loop.status,
        reason: loop.reason,
        loop
      };
    const sub = loop.action === "fix" ? "review-fix" : "review";
    return {
      ...out,
      sub,
      skill: SKILLS[sub],
      ...phaseModel(config, sub),
      loop
    };
  }
  const base = { ...out, skill: SKILLS[phase], ...phaseModel(config, phase) };
  if (phase === "build")
    base.build_resume = existsSync(join(dir, "state.json"));
  if (phase === "fix-review") base.rounds = state.pr_rounds.done + 1;
  if (phase === "pr") Object.assign(base, prOptions(state, config));
  return base;
}

export function cmdNext(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  return dispatch(dir, state, now(env), configOf(state.config_snapshot));
}

/** Draft handling for the pull request phase. */
export function prOptions(state, config) {
  const draft = Boolean(config.pr?.draft);
  const untilReviewed = Boolean(state.pr_draft_until_reviewed);
  return { draft: draft || untilReviewed, mark_ready: untilReviewed && !draft };
}

function parseJsonOption(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new GoError(`--${name}: invalid JSON (${err.message})`, 2);
  }
}

/** Record a phase status and the facts it produced (plan, branch, worktree, PR, summary). */
export function cmdPhase(name, options, env = process.env) {
  const dir = runDirOf(options);
  if (!PHASES.includes(name))
    throw new GoError(
      `Unknown phase: ${name ?? "(missing)"} (${PHASES.join(", ")})`,
      2
    );
  const status = options.status;
  if (!PHASE_STATUSES.includes(status) || status === "pending")
    throw new GoError("--status must be started, done, skipped or failed", 2);
  if (options["base-sha"] && !SHA.test(options["base-sha"]))
    throw new GoError("--base-sha must be a commit SHA", 2);
  let plan = null;
  if (options.plan) {
    const parsed = readPlan(resolve(expandHome(String(options.plan))));
    if (parsed.errors.length > 0)
      throw new GoError(
        `Plan does not parse:\n  ${parsed.errors.join("\n  ")}`
      );
    plan = {
      path: parsed.path,
      title: parsed.plan.title,
      overview: parsed.plan.overview,
      milestones: parsed.plan.milestones.map((m) => m.id)
    };
  }
  const events = [];
  const state = updateState(
    dir,
    (s) => {
      s.phase_status[name] = status;
      if (options.reason)
        s.phase_reasons = {
          ...s.phase_reasons,
          [name]: String(options.reason)
        };
      if (options.base) s.base = options.base;
      if (options["base-sha"]) s.base_sha = options["base-sha"];
      if (plan) {
        s.plan_path = plan.path;
        s.plan_title = plan.title;
        s.milestones = plan.milestones;
        s.summary ??= firstParagraph(plan.overview);
      }
      if (options.branch && options.branch !== s.branch) {
        s.branch = options.branch;
        events.push([
          "branch.created",
          {
            branch: s.branch,
            base: s.base,
            base_sha: s.base_sha,
            worktree: s.worktree
          }
        ]);
      }
      if (options.pr && options.pr !== s.pr) {
        s.pr = options.pr;
        events.push(["pr.opened", { pr: s.pr, branch: s.branch }]);
      }
      if (options.summary) s.summary = String(options.summary).trim();
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
  const out = {
    phase: name,
    status,
    next: nextPhase(state),
    phase_status: state.phase_status
  };
  if (plan) out.milestones = milestoneBudget(state);
  return out;
}

function firstParagraph(text) {
  const para = String(text ?? "")
    .trim()
    .split(/\r?\n\s*\r?\n/)[0];
  return para ? para.replace(/\s*\r?\n\s*/g, " ").trim() : null;
}

/** Plan size vs go.budgets.max_milestones. */
export function milestoneBudget(state) {
  const count = state.milestones?.length ?? 0;
  const max = state.max_milestones;
  const exceeded = max !== null && max !== undefined && count > max;
  let action = "continue";
  if (exceeded)
    action = state.halt_on.includes("budget") ? "halt" : "continue-over-budget";
  return { count, max_milestones: max ?? null, exceeded, action };
}

// ---------------------------------------------------------------------------
// Loops: internal review, pull request rounds
// ---------------------------------------------------------------------------

function stepsByRound(steps, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const byRound = new Map();
  for (const s of steps) {
    const m = re.exec(s.name);
    if (m) byRound.set(Number(m[1]), s);
  }
  return byRound;
}

/**
 * Internal review loop, read from the run's steps: review-<N> (esp-review)
 * and fix-review-<N> (esp-fix-review --internal). A round reviews, then fixes
 * the findings. A clean review ends the loop; so does the last round, and a
 * fix round that fixed nothing. Critical findings left after the last fix halt
 * when critical-security is in go.halt_on.
 */
export function reviewLoop(dir, state, steps = readStepResults(dir)) {
  const max = state.internal_review_rounds;
  if (max === 0)
    return {
      action: "done",
      round: 0,
      max_rounds: 0,
      reason: "internal review disabled"
    };
  const reviews = stepsByRound(steps, "review");
  const fixes = stepsByRound(steps, "fix-review");
  const round = Math.max(0, ...reviews.keys());
  const next = (n) => ({
    action: "review",
    round: n,
    max_rounds: max,
    step: `review-${n}`
  });
  if (round === 0) return next(1);
  const review = reviews.get(round).result;
  if (!FINISHED.has(review.status))
    return {
      action: "stop",
      status: review.status,
      round,
      max_rounds: max,
      reason: `review-${round} ended ${review.status}`
    };
  const findings = review.outputs?.findings ?? 0;
  const critical = review.outputs?.by_severity?.critical ?? 0;
  if (findings === 0)
    return {
      action: "done",
      round,
      max_rounds: max,
      remaining: 0,
      reason: `review-${round} is clean`
    };
  const fix = fixes.get(round)?.result;
  if (!fix)
    return {
      action: "fix",
      round,
      max_rounds: max,
      step: `fix-review-${round}`,
      findings,
      findings_path: review.outputs?.findings_path ?? null
    };
  if (!FINISHED.has(fix.status))
    return {
      action: "stop",
      status: fix.status,
      round,
      max_rounds: max,
      reason: `fix-review-${round} ended ${fix.status}`
    };
  const remaining = fix.outputs?.remaining ?? 0;
  const fixed = fix.outputs?.fixed ?? 0;
  if (round < max && fixed > 0) return next(round + 1);
  if (
    critical > 0 &&
    remaining > 0 &&
    state.halt_on.includes("critical-security")
  )
    return {
      action: "halt",
      key: "critical-security",
      round,
      max_rounds: max,
      remaining,
      reason: `${critical} critical finding(s) in review-${round}, ${remaining} item(s) left after the fix`
    };
  const why =
    fixed === 0
      ? "the fix round fixed nothing"
      : `${max} round${max === 1 ? "" : "s"} used`;
  return {
    action: "done",
    round,
    max_rounds: max,
    remaining,
    exhausted: round >= max,
    reason: `${why}; ${remaining} item(s) left`
  };
}

export function cmdReviewLoop(options) {
  const dir = runDirOf(options);
  return reviewLoop(dir, readState(dir));
}

function latestNamed(steps, name) {
  return steps.filter((s) => s.name === name).at(-1)?.result ?? null;
}

/**
 * Pull request round loop: await-review -> fix-review (one round per call,
 * with --rounds <n>) -> await-review again while the round pushed commits and
 * rounds are left. `--after await|fix` reads that phase's step result.
 */
export function prLoopAction(
  state,
  after,
  result,
  { interactive = state.interactive } = {}
) {
  const { max, done, commits } = state.pr_rounds;
  if (!result)
    return {
      action: after === "await" ? "await" : "fix",
      reason: `no ${after} result yet`
    };
  if (after === "await") {
    if (result.status === "done")
      return { action: "fix", round: done + 1, max_rounds: max };
    if (result.status === "awaiting-human" && interactive === "off")
      return {
        action: "fix",
        round: done + 1,
        max_rounds: max,
        timed_out: true,
        reason: "review wait timed out: fix the comments that arrived"
      };
    return {
      action: "stop",
      status: result.status,
      reason: `await-review ended ${result.status}`
    };
  }
  const o = result.outputs ?? {};
  const total = Array.isArray(o.commits) ? o.commits.length : 0;
  const pushed = total > commits;
  const rounds = Number.isInteger(o.rounds) ? o.rounds : done + 1;
  const update = { done: rounds, commits: total };
  if (!FINISHED.has(result.status))
    return {
      action: "stop",
      status: result.status,
      update,
      reason: `fix-review ended ${result.status}`
    };
  if ((o.open ?? 0) > 0)
    return {
      action: "stop",
      status: "awaiting-human",
      update,
      reason: `${o.open} review item(s) open`
    };
  if (pushed && rounds < max && !o.exhausted)
    return { action: "await", round: rounds + 1, max_rounds: max, update };
  return {
    action: "merge",
    update,
    reason: pushed
      ? `${max} round(s) used`
      : "the round pushed nothing: no re-review needed"
  };
}

export function cmdPrLoop(options, env = process.env) {
  const dir = runDirOf(options);
  const after = options.after;
  if (!["await", "fix"].includes(after))
    throw new GoError("--after must be await or fix", 2);
  const state = readState(dir);
  const result = latestNamed(
    readStepResults(dir),
    after === "await" ? "await-review" : "fix-review"
  );
  const out = prLoopAction(state, after, result);
  if (out.update || out.action === "stop") {
    updateState(
      dir,
      (s) => {
        if (out.update) s.pr_rounds = { ...s.pr_rounds, ...out.update };
        if (out.action === "stop")
          s.stop = {
            status: out.status,
            reason: out.reason,
            at: now(env).toISOString()
          };
      },
      env
    );
  }
  return out;
}

/** Record that a loop or phase stopped the task (the result status follows it). */
export function cmdStop(options, env = process.env) {
  const dir = runDirOf(options);
  const statuses = ["awaiting-human", "failed", "halted"];
  if (!statuses.includes(options.status))
    throw new GoError(`--status must be one of ${statuses.join(", ")}`, 2);
  if (!options.reason) throw new GoError("stop needs --reason <text>", 2);
  return updateState(
    dir,
    (s) => {
      s.stop = {
        status: options.status,
        reason: String(options.reason),
        at: now(env).toISOString()
      };
      for (const p of s.phases)
        if (["pending", "started"].includes(s.phase_status[p]))
          s.phase_status[p] = "skipped";
    },
    env
  ).stop;
}

// ---------------------------------------------------------------------------
// Worktree
// ---------------------------------------------------------------------------

/** Create the task worktree under worktrees.root, on a new branch from `from`. */
export function cmdWorktree(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  if (!options.branch || options.branch === true)
    throw new GoError("worktree needs --branch <name>", 2);
  if (state.worktree)
    return { path: state.worktree, branch: state.branch, created: false };
  const config = configOf(state.config_snapshot);
  const root = resolve(
    expandHome(String(config.worktrees?.root ?? "~/.esp-skills/worktrees"))
  );
  const path = join(root, runJson(dir).id);
  mkdirSync(dirname(path), { recursive: true });
  const from = options.from ?? (state.base ? `origin/${state.base}` : "HEAD");
  const exists = tryGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${options.branch}`],
    state.repo_dir
  );
  if (exists)
    git(["worktree", "add", path, String(options.branch)], state.repo_dir);
  else
    git(
      ["worktree", "add", "-b", String(options.branch), path, from],
      state.repo_dir
    );
  const baseSha = git(["rev-parse", "HEAD"], path).trim();
  const updated = updateState(
    dir,
    (s) => {
      s.worktree = path;
      s.project_dir = path;
      s.branch = String(options.branch);
      if (!exists) s.base_sha = baseSha;
    },
    env
  );
  appendEvent(
    dir,
    "branch.created",
    {
      branch: updated.branch,
      base: updated.base,
      base_sha: updated.base_sha,
      worktree: path
    },
    env
  );
  cmdUpdate({ "run-dir": dir, branch: updated.branch }, env);
  return {
    path,
    branch: updated.branch,
    base_sha: updated.base_sha,
    created: true,
    reused_branch: Boolean(exists)
  };
}

// ---------------------------------------------------------------------------
// Result blocks
// ---------------------------------------------------------------------------

function assertBlock(block) {
  const { valid, errors } = validateArtifact("result", block);
  if (!valid)
    throw new GoError(
      `Invalid result block:\n  ${errors.map((e) => `${e.path}: ${e.message}`).join("\n  ")}`
    );
  return block;
}

function commitsSince(projectDir, base) {
  const out = tryGit(["log", "--format=%H %s", `${base}..HEAD`], projectDir);
  return lines(out).map((line) => {
    const space = line.indexOf(" ");
    return { sha: line.slice(0, space), subject: line.slice(space + 1) };
  });
}

const filesSince = (projectDir, base) =>
  lines(tryGit(["diff", "--name-only", `${base}..HEAD`], projectDir));

function pick(object, keys) {
  if (!object) return null;
  return Object.fromEntries(
    keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]])
  );
}

function baseOutputs(state, dir) {
  return {
    request: state.request,
    branch: state.branch,
    base: state.base,
    base_sha: state.base_sha,
    pr: state.pr,
    plan_path: state.plan_path,
    worktree: state.worktree,
    phases: state.phase_status,
    escalated_from: state.escalated_from ?? undefined,
    state_path: statePath(dir),
    summary_path: join(dir, "summary.md")
  };
}

/** Halt the task under a go.halt_on key: log the Halt decision and build the block. */
export function cmdHalt(options, env = process.env) {
  const dir = runDirOf(options);
  const key = options.key;
  if (!HALT_KEYS.includes(key))
    throw new GoError(`--key must be one of ${HALT_KEYS.join(", ")}`, 2);
  if (!options.reason) throw new GoError("halt needs --reason <text>", 2);
  const decision = appendDecision(
    dir,
    {
      phase: options.phase ?? "go",
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
      for (const p of s.phases)
        if (["pending", "started"].includes(s.phase_status[p]))
          s.phase_status[p] = "skipped";
    },
    env
  );
  const projectDir = projectDirOf(options, state);
  return assertBlock({
    contract_version: 1,
    status: "halted",
    summary: `Halted (${key}): ${options.reason}`,
    files_changed: filesSince(projectDir, state.base_sha),
    commit: tryGit(["rev-parse", "HEAD"], projectDir)?.trim() ?? null,
    pr: state.pr,
    max_risk: "high",
    blockers: [`${key}: ${options.reason}`],
    outputs: { ...baseOutputs(state, dir), halt: state.halt }
  });
}

/**
 * Final result block. The status is the one of the last phase step that ran
 * (an earlier step that did not end done was continued past), unless the task
 * halted or a loop stopped it; merged wins over done.
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
  const ordered = [];
  const named = (n) => latestNamed(steps, n);
  const reviews = [...stepsByRound(steps, "review").entries()].sort(
    (a, b) => a[0] - b[0]
  );
  const fixes = stepsByRound(steps, "fix-review");
  for (const [name, result] of [
    ["plan", named("plan")],
    ["build", named("build")]
  ])
    if (result) ordered.push({ name, result });
  for (const [n, s] of reviews) {
    ordered.push({ name: s.name, result: s.result });
    if (fixes.has(n))
      ordered.push({ name: fixes.get(n).name, result: fixes.get(n).result });
  }
  for (const name of ["await-review", "fix-review", "merge"])
    if (named(name)) ordered.push({ name, result: named(name) });
  const last = ordered.at(-1) ?? null;
  let derived = last ? last.result.status : "done";
  let carrier = last;
  if (named("merge")?.status === "merged") derived = "merged";
  if (state.stop) derived = state.stop.status;
  if (state.halt) derived = "halted";
  if (derived === "escalate") derived = "failed";
  if (
    !state.halt &&
    derived === "halted" &&
    last &&
    !FINISHED.has(last.result.status)
  )
    carrier = last;
  const finalStatus = status ?? derived;
  const commits = commitsSince(projectDir, state.base_sha);
  const build = existsSync(join(dir, "state.json"))
    ? readJson(join(dir, "state.json"))
    : null;
  const milestoneCommits = build?.milestones
    ? Object.fromEntries(
        Object.entries(build.milestones)
          .filter(([, m]) => m.commit)
          .map(([id, m]) => [id, m.commit])
      )
    : {};
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
  const loop = reviewLoop(dir, state, steps);
  const files = filesSince(projectDir, state.base_sha);
  const buildResultBlock = named("build");
  const block = {
    contract_version: 1,
    status: finalStatus,
    summary:
      summary ??
      defaultSummary(
        finalStatus,
        state,
        named("merge"),
        Object.keys(milestoneCommits).length
      ),
    files_changed: files,
    commit: tryGit(["rev-parse", "HEAD"], projectDir)?.trim() ?? null,
    pr: state.pr,
    gates: buildResultBlock?.gates,
    max_risk: runRisk,
    outputs: {
      ...baseOutputs(state, dir),
      milestones: state.milestones ?? [],
      milestones_done:
        buildResultBlock?.outputs?.milestones_done ??
        Object.keys(milestoneCommits),
      milestone_commits: milestoneCommits,
      commits: commits.map((c) => c.sha),
      review_fix_commits: reviewFixCommits.length,
      files_count: files.length,
      internal_review: {
        rounds: reviews.length,
        max_rounds: state.internal_review_rounds,
        remaining: loop.remaining ?? null,
        exhausted: loop.exhausted ?? false
      },
      pr_rounds: state.pr_rounds,
      fix_review: pick(named("fix-review")?.outputs, [
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
      merge: pick(named("merge")?.outputs, [
        "outcome",
        "merged",
        "method",
        "method_reason",
        "failing"
      ]),
      stop: state.stop ?? undefined,
      halt: state.halt ?? undefined
    }
  };
  if (discovered.length > 0) block.discovered_items = discovered;
  if (finalStatus === "awaiting-human" && carrier?.result.needs_input)
    block.needs_input = carrier.result.needs_input;
  if (!FINISHED.has(finalStatus)) {
    const blockers = [...(carrier?.result.blockers ?? [])];
    if (state.stop) blockers.unshift(state.stop.reason);
    if (state.halt) blockers.unshift(`${state.halt.key}: ${state.halt.reason}`);
    if (blockers.length > 0) block.blockers = [...new Set(blockers)];
  }
  for (const key of ["gates"]) if (block[key] === undefined) delete block[key];
  for (const key of ["stop", "halt", "escalated_from"])
    if (block.outputs[key] === undefined) delete block.outputs[key];
  return assertBlock(block);
}

function defaultSummary(status, state, merge, built) {
  const pr = state.pr ? ` ${state.pr}` : "";
  const what = state.plan_title ? `"${state.plan_title}"` : "the task";
  const milestones = state.milestones
    ? ` (${built} of ${state.milestones.length} milestones)`
    : "";
  switch (status) {
    case "merged":
      return `Merged ${what}${milestones}:${pr} with ${merge?.outputs?.method ?? "the resolved method"}.`;
    case "done":
      return state.pr
        ? `Done ${what}${milestones}:${pr}.`
        : `Built ${what}${milestones} on ${state.branch ?? "the branch"}.`;
    case "halted":
      return `Halted ${what}${state.halt ? ` (${state.halt.key}): ${state.halt.reason}` : state.stop ? `: ${state.stop.reason}` : "."}`;
    case "awaiting-human":
      return `Waiting for a human on ${what}${pr}${state.stop ? `: ${state.stop.reason}` : "."}`;
    default:
      return `Failed ${what}${pr}${state.stop ? `: ${state.stop.reason}` : "."}`;
  }
}

export function cmdResult(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  if (options.status !== undefined) {
    const statuses = ["done", "merged", "halted", "awaiting-human", "failed"];
    if (!statuses.includes(options.status))
      throw new GoError(`--status must be one of ${statuses.join(", ")}`, 2);
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

/** Body from plan.md (title and overview), the build state, decisions.jsonl and the step results. */
export function cmdPrBody(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const config = configOf(state.config_snapshot);
  const summary = options.summary ?? state.summary ?? state.request;
  const sections = config.pr?.body_sections ?? BODY_SECTIONS;
  const attribution = config.pr?.attribution === false ? null : ATTRIBUTION;
  const body = renderPrBody(collectRunArtifacts(dir), {
    summary,
    sections,
    attribution
  });
  if (options.out) {
    const out = resolve(String(options.out));
    writeFileSync(out, body, "utf8");
    return { path: out, bytes: Buffer.byteLength(body) };
  }
  return body;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node go.mjs <command> [args] --run-dir <path> [options]

Commands:
  init                 Create go.json (--request <text> --base <branch>); resolves the phases,
                       freezes the config, and picks up an esp-go-light escalation in the run.
                       A second call prints the state
  show                 Print go.json
  next                 What to run now: { action, phase, sub, skill, role, model, effort, cwd, ... }
  phase <name>         Record a phase: --status started|done|skipped|failed, and its facts
                       (--plan <file>, --branch, --base, --base-sha, --pr, --summary, --reason)
  review-loop          Internal review loop state: review, fix, done, stop or halt
  pr-loop              Pull request rounds after a phase (--after await|fix): await, fix, merge or stop
  worktree             Create the task worktree on --branch <name> (from --from, default origin/<base>)
  budget               Elapsed wall time vs go.budgets.max_wall_minutes
  stop                 Record a stop (--status awaiting-human|failed|halted --reason <text>)
  halt                 Halt under a go.halt_on key (--key --reason), log it, print the halted block
  pr-body              Pull request body from the run artifacts (--summary <text>, --out <file>)
  result               Final result block (--status, --summary); exits with its contract code

Options:
  --run-dir <path>          Run directory (required)
  --config-snapshot <path>  Config snapshot (init; later commands use the frozen one)
  --project-dir <dir>       Repository root (default: recorded at init, else the git root)
  --no-pr, --no-merge       init: stop before the pull request, or before the merge
  --worktree                init: build in a task worktree (default: go.worktree)
  --max-rounds <n>          init: pull request fix rounds (default: fix-review.max_rounds)
  --interactive <mode>      init: off, plan or all (default: defaults.interactive)
  --reviewers <names>       init: reviewers to wait for and fix (default: go.default_reviewers)
  --help                    Show this help`;

const BOOLEAN_FLAGS = new Set(["no-pr", "no-merge", "worktree", "help"]);

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
          throw new GoError(`--${key} requires a value`, 2);
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
    case "next":
      return { output: cmdNext(options, env) };
    case "phase":
      return { output: cmdPhase(args[0], options, env) };
    case "review-loop":
      return { output: cmdReviewLoop(options) };
    case "pr-loop":
      return { output: cmdPrLoop(options, env) };
    case "worktree":
      return { output: cmdWorktree(options, env) };
    case "budget":
      return { output: budgetCheck(readState(runDirOf(options)), now(env)) };
    case "stop":
      return { output: cmdStop(options, env) };
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
      throw new GoError(`Unknown command: ${command}\n\n${USAGE}`, 2);
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
    const known = [
      "GoError",
      "GoLightError",
      "RunsError",
      "LockTimeoutError",
      "PlanError"
    ].includes(err.name);
    process.stderr.write(
      `go error: ${known ? err.message : (err.stack ?? err)}\n`
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
