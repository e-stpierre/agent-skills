// Phases of esp-ship: the phase list of each track, init and resume, what to
// run next (with the role model of the phase subagent), the facts each phase
// records, the budgets and the stop.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome } from "../../config.mjs";
import { readPlan } from "../../plan.mjs";
import { appendEvent, cmdUpdate, latestPlan, now } from "../../runs.mjs";
import { finalGatesState, gatesFor } from "./gates.mjs";
import {
  modeOf,
  PLAN_MODES,
  REVIEW_MODES,
  reviewPlan,
  reviewSkipReason
} from "./review-gate.mjs";
import { reviewLoop } from "./review-loop.mjs";
import { prOptions } from "./tail.mjs";
import {
  CORE_PHASE,
  configOf,
  freezeConfig,
  GATE_FAILURE_LIMIT,
  git,
  INTERACTIVE_MODES,
  PHASE_STATUSES,
  parseJsonOption,
  positiveInt,
  projectDirOf,
  readState,
  runDirOf,
  SHA,
  ShipError,
  shipSettings,
  skipUnfinished,
  statePath,
  stringOption,
  TRACK_PHASES,
  TRACKS,
  updateState,
  WAIT_PHASES,
  WAIT_STEP,
  writeNewState
} from "./state.mjs";

/**
 * Role of each orchestrated phase subagent, resolved through
 * defaults.models.<role>. `null` runs in the main session: the milestone loop
 * (build) spawns its own builders and verifiers, and the review wait wakes the
 * main session. The inline track runs every phase in the main session.
 */
export const PHASE_ROLES = {
  plan: "planner",
  context: null,
  branch: "mechanical",
  implement: null,
  build: null,
  "final-gates": null,
  review: "reviewer",
  "review-fix": "fixer",
  pr: "mechanical",
  "fix-review": "fixer",
  merge: "fixer"
};
const SKILLS = {
  plan: "esp-plan",
  context: null,
  branch: "esp-branch",
  implement: null,
  build: null,
  "final-gates": null,
  review: "esp-review",
  "review-fix": "esp-fix-review",
  pr: "esp-pr",
  "fix-review": "esp-fix-review",
  merge: "esp-merge"
};

// ---------------------------------------------------------------------------
// Phase lists
// ---------------------------------------------------------------------------

/**
 * Phases of a track, in canonical order, from the configured phases and the
 * flags. The core phase (implement, build) is required. The orchestrated track
 * always keeps `plan`: its build needs a plan file, generated, imported,
 * reused or synthesized. --no-pr drops the pull request and its wait phases,
 * --stop-before-wait leaves the wait phases to the caller, --no-merge drops
 * the merge, and internal_review_rounds 0 drops the internal review. The
 * review mode drops the internal review (pr, none) or the pull request
 * review rounds (internal, none); auto keeps the internal review until the
 * review gate decides it after the build.
 */
export function resolvePhases(
  track = "orchestrated",
  configured = TRACK_PHASES[track],
  {
    noPr = false,
    noMerge = false,
    stopBeforeWait = false,
    reviewRounds = 2,
    reviewMode = "auto",
    reviewSource = "default"
  } = {}
) {
  if (!TRACKS.includes(track))
    throw new ShipError(`--track must be one of ${TRACKS.join(", ")}`, 2);
  const wanted = new Set(configured);
  if (!wanted.has(CORE_PHASE[track]))
    throw new ShipError(
      `The configured phases must include ${CORE_PHASE[track]} (${track} track)`,
      1
    );
  if (!REVIEW_MODES.includes(reviewMode))
    throw new ShipError(
      `--review-mode must be one of ${REVIEW_MODES.join(", ")}`,
      2
    );
  const review = reviewPlan(reviewMode, reviewRounds);
  const reviewReason = reviewSkipReason(reviewMode, reviewSource);
  const phases = [];
  const skipped = {};
  for (const phase of TRACK_PHASES[track]) {
    if (phase === "plan") phases.push(phase);
    else if (!wanted.has(phase))
      skipped[phase] = "not in the configured phases";
    else if (phase === "review" && reviewRounds === 0)
      skipped[phase] = "internal_review_rounds is 0";
    else if (phase === "review" && review.internal === "off")
      skipped[phase] = reviewReason;
    else if (phase === "pr" && noPr) skipped[phase] = "--no-pr";
    else if (WAIT_PHASES.includes(phase) && (noPr || !wanted.has("pr")))
      skipped[phase] = noPr ? "--no-pr" : "needs the pr phase";
    else if (WAIT_PHASES.includes(phase) && stopBeforeWait)
      skipped[phase] = "left to the caller (--stop-before-wait)";
    else if (phase === "fix-review" && !review.pr)
      skipped[phase] = reviewReason;
    else if (phase === "merge" && noMerge) skipped[phase] = "--no-merge";
    else phases.push(phase);
  }
  return { phases, skipped };
}

/**
 * Put the state on a track: its phases, statuses and limits. Phases both
 * tracks share (the branch, the tail) keep their progress.
 */
export function applyTrack(state, track, config) {
  const settings = shipSettings(config, track);
  const { phases, skipped } = resolvePhases(track, settings.phases, {
    noPr: state.flags.no_pr,
    noMerge: state.flags.no_merge,
    stopBeforeWait: state.stop_before_wait,
    reviewRounds: state.internal_review_rounds,
    reviewMode: state.review_mode ?? "auto",
    reviewSource: state.review_mode_source ?? "default"
  });
  const previous = state.phase_status ?? {};
  state.track = track;
  state.phases = phases;
  state.skipped_phases = skipped;
  state.phase_status = Object.fromEntries(
    TRACK_PHASES[track].map((p) => [
      p,
      !phases.includes(p)
        ? "skipped"
        : ["done", "started"].includes(previous[p])
          ? previous[p]
          : "pending"
    ])
  );
  state.max_wall_minutes = settings.max_wall_minutes;
  return state;
}

// ---------------------------------------------------------------------------
// init and resume
// ---------------------------------------------------------------------------

export function cmdInit(options, env = process.env) {
  const dir = runDirOf(options);
  const path = statePath(dir);
  if (existsSync(path)) {
    if (options.resume) return resumeRun(dir, env);
    return { state_path: path, created: false, ...readState(dir) };
  }
  if (options.resume)
    throw new ShipError(`No ship.json in ${dir}: nothing to resume`, 2);
  const request = stringOption(options.request)?.trim();
  if (!request) throw new ShipError("init needs --request <text>", 2);
  const track = stringOption(options.track) ?? "orchestrated";
  if (!TRACKS.includes(track))
    throw new ShipError(`--track must be one of ${TRACKS.join(", ")}`, 2);
  const projectDir = projectDirOf(options, null);
  const snapshot = freezeConfig(dir, {
    snapshot: stringOption(options["config-snapshot"]),
    projectDir
  });
  const config = configOf(snapshot);
  const settings = shipSettings(config, track);
  const interactive =
    stringOption(options.interactive) ?? config.defaults?.interactive ?? "off";
  if (!INTERACTIVE_MODES.includes(interactive))
    throw new ShipError(
      `--interactive must be one of ${INTERACTIVE_MODES.join(", ")}`,
      2
    );
  const planMode = modeOf(
    options["plan-mode"],
    config.ship?.plan_mode,
    PLAN_MODES,
    "plan-mode"
  );
  const reviewMode = modeOf(
    options["review-mode"],
    config.ship?.review_mode,
    REVIEW_MODES,
    "review-mode"
  );
  if (options["base-sha"] && !SHA.test(options["base-sha"]))
    throw new ShipError("--base-sha must be a commit SHA", 2);
  const at = now(env).toISOString();
  const state = {
    state_format: 1,
    workflow: "esp-ship",
    track,
    run_owner: options["caller-owned"] ? "caller" : "self",
    request,
    project_dir: projectDir,
    repo_dir: projectDir,
    base: stringOption(options.base) ?? config.pr?.base ?? null,
    base_sha:
      stringOption(options["base-sha"]) ??
      git(["rev-parse", "HEAD"], projectDir).trim(),
    branch: null,
    worktree: null,
    use_worktree:
      options.worktree === undefined
        ? Boolean(settings.worktree)
        : Boolean(options.worktree),
    plan_path: null,
    plan_title: null,
    plan_source: stringOption(options["plan-source"]),
    plan_mode: planMode.mode,
    plan_mode_source: planMode.source,
    review_mode: reviewMode.mode,
    review_mode_source: reviewMode.source,
    review_gate: null,
    milestones: null,
    commit: null,
    pr: null,
    summary: null,
    interactive,
    reviewers: stringOption(options.reviewers),
    created_at: at,
    updated_at: at,
    config_snapshot: snapshot,
    flags: {
      no_pr: Boolean(options["no-pr"]),
      no_merge: Boolean(options["no-merge"])
    },
    stop_before_wait: Boolean(options["stop-before-wait"]),
    phases: [],
    skipped_phases: {},
    phase_status: {},
    internal_review_rounds: settings.internal_review_rounds,
    pr_rounds: {
      max:
        options["max-rounds"] !== undefined
          ? positiveInt(options["max-rounds"], "max-rounds")
          : (config["fix-review"]?.max_rounds ?? 3),
      done: 0,
      commits: 0
    },
    pr_draft_until_reviewed: settings.pr_draft_until_reviewed,
    max_files_changed: settings.max_files_changed,
    escalate: settings.escalate,
    max_milestones: settings.max_milestones,
    max_wall_minutes: settings.max_wall_minutes,
    halt_on: settings.halt_on,
    gate_failures: 0,
    gate_failure_limit: GATE_FAILURE_LIMIT,
    gate_failure_reasons: [],
    gates: {},
    escalation: null,
    escalated_from: null,
    track_history: [],
    stop: null,
    halt: null
  };
  applyTrack(state, track, config);
  writeNewState(dir, state);
  return { state_path: path, created: true, ...state };
}

/**
 * Resume a run. An awaiting-human stop is lifted and the phases it left
 * unfinished are restored, keeping the completed work. A caller-owned run
 * that escalated is taken over on the orchestrated track, in the same run.
 * Halted and failed runs stay stopped.
 */
export function resumeRun(dir, env = process.env) {
  const path = statePath(dir);
  let resumed = null;
  let takeover = null;
  const state = updateState(
    dir,
    (s) => {
      if (s.halt) return;
      if (s.escalation && s.track === "inline") {
        takeover = s.escalation;
        const { decision, trigger, reason, files, patch, stash, at } =
          s.escalation;
        s.escalated_from = {
          track: "inline",
          trigger,
          reason,
          files: files ?? [],
          patch: patch ?? null,
          stash: stash ?? null,
          decision,
          in_place: false
        };
        s.track_history = [
          ...(s.track_history ?? []),
          {
            from: "inline",
            to: "orchestrated",
            trigger,
            reason,
            decision,
            at,
            phase_status: s.phase_status
          }
        ];
        s.escalation = null;
        applyTrack(s, "orchestrated", configOf(s.config_snapshot));
        return;
      }
      if (s.stop?.status !== "awaiting-human") return;
      resumed = s.stop;
      for (const [p, status] of Object.entries(s.stop.unfinished ?? {}))
        if (s.phase_status[p] === "skipped") s.phase_status[p] = status;
      s.stop = null;
    },
    env
  );
  if (takeover) {
    cmdUpdate({ "run-dir": dir, status: "running" }, env);
    appendEvent(
      dir,
      "run.resumed",
      { by: "esp-ship", from: "inline", trigger: takeover.trigger },
      env
    );
  } else if (resumed)
    appendEvent(
      dir,
      "run.resumed",
      { by: "esp-ship", from: "awaiting-human", reason: resumed.reason },
      env
    );
  return {
    state_path: path,
    created: false,
    resumed: Boolean(resumed || takeover),
    taken_over: Boolean(takeover),
    ...state
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Role model of a phase subagent from defaults.models.<role>. `null` runs in
 * the main session, as does every phase of the inline track.
 */
export function phaseModel(config, phase, track = "orchestrated") {
  const role = track === "inline" ? null : PHASE_ROLES[phase];
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

/** Plan size vs the max_milestones budget. */
export function milestoneBudget(state) {
  const count = state.milestones?.length ?? 0;
  const max = state.max_milestones;
  const exceeded = max !== null && max !== undefined && count > max;
  let action = "continue";
  if (exceeded)
    action = state.halt_on.includes("budget") ? "halt" : "continue-over-budget";
  return { count, max_milestones: max ?? null, exceeded, action };
}

/** What the orchestrator runs now: the phase, its subagent model, and what it needs. */
export function dispatch(dir, state, at, config) {
  if (state.halt)
    return { action: "result", reason: `halted (${state.halt.key})` };
  if (state.escalation)
    return {
      action: "result",
      reason: `escalated (${state.escalation.trigger}): the caller decides`
    };
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
    track: state.track,
    phase,
    resumed: state.phase_status[phase] === "started",
    cwd,
    budget
  };
  if (
    phase === "review" &&
    state.phase_status.review === "pending" &&
    !state.review_gate &&
    reviewPlan(state.review_mode ?? "auto", state.internal_review_rounds)
      .internal === "auto"
  )
    return {
      ...out,
      action: "review-gate",
      reason:
        "review_mode auto: run ship.mjs review-gate to decide the internal review from the diff"
    };
  if (phase === "review") {
    const loop = reviewLoop(dir, state);
    if (loop.action === "done")
      return { ...out, action: "complete", loop, reason: loop.reason };
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
      ...phaseModel(config, sub, state.track),
      loop
    };
  }
  const base = {
    ...out,
    skill: SKILLS[phase],
    ...phaseModel(config, phase, state.track)
  };
  if (phase === "plan") {
    const latest = latestPlan(dir).path;
    base.plan_source = state.plan_source ?? (latest ? "reuse" : "generate");
    base.latest_plan = latest;
    base.plan_mode = state.plan_mode ?? "auto";
    // reuse and synthesize need no model; import converts on sonnet.
    if (["reuse", "synthesize"].includes(base.plan_source))
      Object.assign(base, { role: null, model: null, skill: null });
    else if (base.plan_source === "import") {
      base.model = "sonnet";
      delete base.effort;
    }
  }
  if (phase === "build") {
    base.milestone_loop = true;
    base.build_resume = existsSync(join(dir, "state.json"));
    base.plan_path = state.plan_path;
  }
  if (phase === "final-gates") {
    const fg = finalGatesState(state);
    const { gates, sources, commands } = gatesFor({
      projectDir: cwd,
      snapshot: state.config_snapshot,
      scope: "full"
    });
    Object.assign(base, {
      gates,
      sources,
      commands,
      runs: fg.runs,
      fix_rounds: fg.fix_rounds,
      max_fix_rounds: fg.max_fix_rounds
    });
  }
  if (phase === "fix-review") {
    // Each round starts with the review and checks wait, run by this session.
    base.rounds = state.pr_rounds.done + 1;
    base.wait_step = WAIT_STEP;
    base.wait_checks = true;
  }
  if (phase === "pr") Object.assign(base, prOptions(state, config));
  return base;
}

export function cmdNext(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  return dispatch(dir, state, now(env), configOf(state.config_snapshot));
}

// ---------------------------------------------------------------------------
// phase: record a phase status and its facts
// ---------------------------------------------------------------------------

function firstParagraph(text) {
  const para = String(text ?? "")
    .trim()
    .split(/\r?\n\s*\r?\n/)[0];
  return para ? para.replace(/\s*\r?\n\s*/g, " ").trim() : null;
}

function planFacts(dir, state, name, status, options) {
  if (state.track !== "orchestrated") {
    if (options.plan)
      throw new ShipError("--plan is for the orchestrated track", 2);
    return null;
  }
  if (name === "plan" && status === "skipped")
    throw new ShipError(
      "The orchestrated track needs a plan file: record plan done with --plan <file> (reused, imported, generated or synthesized)",
      2
    );
  const explicit = stringOption(options.plan);
  const file = explicit
    ? resolve(expandHome(explicit))
    : name === "plan" && status === "done" && !state.plan_path
      ? latestPlan(dir).path
      : null;
  if (name === "plan" && status === "done" && !file && !state.plan_path)
    throw new ShipError(
      `No plan file: pass --plan <file> or write plan.md in ${dir}`,
      2
    );
  if (name === "build" && !state.plan_path && !file)
    throw new ShipError(
      "The build needs a plan file: record the plan phase first",
      2
    );
  if (!file) return null;
  const parsed = readPlan(file);
  if (parsed.errors.length > 0)
    throw new ShipError(
      `Plan does not parse:\n  ${parsed.errors.join("\n  ")}`
    );
  return {
    path: parsed.path,
    title: parsed.plan.title,
    overview: parsed.plan.overview,
    milestones: parsed.plan.milestones.map((m) => m.id)
  };
}

/** Record a phase status and the facts it produced (plan, branch, commit, PR, gates, summary). */
export function cmdPhase(name, options, env = process.env) {
  const dir = runDirOf(options);
  const current = readState(dir);
  const allowed = TRACK_PHASES[current.track];
  if (!allowed.includes(name))
    throw new ShipError(
      `Unknown ${current.track} phase: ${name ?? "(missing)"} (${allowed.join(", ")})`,
      2
    );
  const status = options.status;
  if (!PHASE_STATUSES.includes(status) || status === "pending")
    throw new ShipError("--status must be started, done, skipped or failed", 2);
  for (const key of ["commit", "base-sha"])
    if (options[key] && !SHA.test(options[key]))
      throw new ShipError(`--${key} must be a commit SHA`, 2);
  const gates =
    options.gates === undefined
      ? null
      : parseJsonOption(options.gates, "gates");
  const plan = planFacts(dir, current, name, status, options);
  const events = [];
  const state = updateState(
    dir,
    (s) => {
      s.phase_status[name] = status;
      if (stringOption(options.reason))
        s.phase_reasons = {
          ...s.phase_reasons,
          [name]: String(options.reason)
        };
      if (stringOption(options.base)) s.base = options.base;
      if (options["base-sha"]) s.base_sha = options["base-sha"];
      if (plan) {
        s.plan_path = plan.path;
        s.plan_title = plan.title;
        s.milestones = plan.milestones;
        s.summary ??= firstParagraph(plan.overview);
      }
      if (stringOption(options.branch) && options.branch !== s.branch) {
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
      if (options.commit && options.commit !== s.commit) {
        s.commit = options.commit;
        events.push(["commit.created", { commit: s.commit, phase: name }]);
      }
      if (stringOption(options.pr) && options.pr !== s.pr) {
        s.pr = options.pr;
        events.push(["pr.opened", { pr: s.pr, branch: s.branch }]);
      }
      if (stringOption(options.summary))
        s.summary = String(options.summary).trim();
      if (gates) s.gates = { ...s.gates, ...gates };
    },
    env
  );
  for (const [type, data] of events) appendEvent(dir, type, data, env);
  const runFields = {};
  for (const key of ["branch", "base", "pr"])
    if (stringOption(options[key])) runFields[key] = options[key];
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

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

/** Record that a loop or phase stopped the task (the result status follows it). */
export function cmdStop(options, env = process.env) {
  const dir = runDirOf(options);
  const statuses = ["awaiting-human", "failed", "halted"];
  if (!statuses.includes(options.status))
    throw new ShipError(`--status must be one of ${statuses.join(", ")}`, 2);
  if (!stringOption(options.reason))
    throw new ShipError("stop needs --reason <text>", 2);
  return updateState(
    dir,
    (s) => {
      // Keep the unfinished phases, so a resume after an awaiting-human stop restores them.
      const unfinished = skipUnfinished(s);
      s.stop = {
        status: options.status,
        reason: String(options.reason),
        at: now(env).toISOString(),
        unfinished
      };
    },
    env
  ).stop;
}
