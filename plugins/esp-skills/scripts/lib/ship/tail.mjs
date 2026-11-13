// The shared tail of both tracks: the pull request options, the review wait
// and fix rounds, the pull request body, the halt, and the final result block.

import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateArtifact } from "../contract.mjs";
import {
  ATTRIBUTION,
  BODY_SECTIONS,
  collectRunArtifacts,
  readStepResults,
  renderPrBody
} from "../pr-body.mjs";
import { appendDecision, now } from "../../runs.mjs";
import { reviewLoop } from "./review-loop.mjs";
import {
  commitsSince,
  configOf,
  FINISHED,
  filesSince,
  HALT_KEYS,
  headOf,
  latestNamed,
  projectDirOf,
  readJson,
  readState,
  runDirOf,
  runJson,
  ShipError,
  skipUnfinished,
  statePath,
  stepsByRound,
  stringOption,
  updateState,
  WAIT_PHASES,
  WAIT_STEP
} from "./state.mjs";

export const RESULT_STATUSES = [
  "done",
  "merged",
  "halted",
  "awaiting-human",
  "failed",
  "escalate"
];

// ---------------------------------------------------------------------------
// Pull request rounds
// ---------------------------------------------------------------------------

/** Draft handling for the pull request phase. */
export function prOptions(state, config) {
  const draft = Boolean(config.pr?.draft);
  const untilReviewed = Boolean(state.pr_draft_until_reviewed);
  return { draft: draft || untilReviewed, mark_ready: untilReviewed && !draft };
}

/**
 * Pull request round loop: wait (reviews and checks of the head, step
 * `fix-review-wait`) -> fix-review (one round per call, with --rounds <n>)
 * -> wait again while the round pushed commits and rounds are left.
 * `--after wait|fix` reads that step's result.
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
      action: after === "wait" ? "wait" : "fix",
      reason: `no ${after} result yet`
    };
  if (after === "wait") {
    const failing = result.outputs?.checks?.failing ?? [];
    const checks = failing.length > 0 ? { failing_checks: failing } : {};
    if (result.status === "done")
      return { action: "fix", round: done + 1, max_rounds: max, ...checks };
    if (result.status === "awaiting-human" && interactive === "off")
      return {
        action: "fix",
        round: done + 1,
        max_rounds: max,
        ...checks,
        timed_out: true,
        reason:
          "the wait timed out: fix the comments and the failing checks that arrived"
      };
    return {
      action: "stop",
      status: result.status,
      reason: `the review wait ended ${result.status}`
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
    return { action: "wait", round: rounds + 1, max_rounds: max, update };
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
  if (!["wait", "fix"].includes(after))
    throw new ShipError("--after must be wait or fix", 2);
  const state = readState(dir);
  const result = latestNamed(
    readStepResults(dir),
    after === "wait" ? WAIT_STEP : "fix-review"
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
  const attribution =
    config.pr?.attribution === false
      ? null
      : (stringOption(options.attribution) ?? ATTRIBUTION);
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
// Result blocks
// ---------------------------------------------------------------------------

export function assertBlock(block) {
  const { valid, errors } = validateArtifact("result", block);
  if (!valid)
    throw new ShipError(
      `Invalid result block:\n  ${errors.map((e) => `${e.path}: ${e.message}`).join("\n  ")}`
    );
  return block;
}

function pick(object, keys) {
  if (!object) return null;
  return Object.fromEntries(
    keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]])
  );
}

export function baseOutputs(state, dir) {
  const out = {
    request: state.request,
    track: state.track,
    run_owner: state.run_owner,
    branch: state.branch,
    base: state.base,
    base_sha: state.base_sha,
    pr: state.pr,
    plan_path: state.plan_path,
    worktree: state.worktree,
    workspace: state.workspace ?? null,
    phases: state.phase_status,
    skipped_phases: state.skipped_phases ?? {},
    plan_mode: state.plan_mode ?? "auto",
    review_mode: state.review_mode ?? "auto",
    review_gate: state.review_gate ?? null,
    gate_failures: state.gate_failures,
    stop_before_wait: state.stop_before_wait,
    state_path: statePath(dir),
    summary_path: join(dir, "summary.md")
  };
  if (state.escalated_from) out.escalated_from = state.escalated_from;
  if (state.track_history?.length > 0) out.track_history = state.track_history;
  return out;
}

/** Halt the task under a halt_on key: log the Halt decision and build the block. */
export function cmdHalt(options, env = process.env) {
  const dir = runDirOf(options);
  const key = options.key;
  if (!HALT_KEYS.includes(key))
    throw new ShipError(`--key must be one of ${HALT_KEYS.join(", ")}`, 2);
  if (!stringOption(options.reason))
    throw new ShipError("halt needs --reason <text>", 2);
  const decision = appendDecision(
    dir,
    {
      phase: stringOption(options.phase) ?? "ship",
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
      skipUnfinished(s);
    },
    env
  );
  const projectDir = projectDirOf(options, state);
  return assertBlock({
    contract_version: 1,
    status: "halted",
    summary: `Halted (${key}): ${options.reason}`,
    files_changed: filesSince(projectDir, state.base_sha),
    commit: headOf(projectDir),
    pr: state.pr,
    max_risk: "high",
    blockers: [`${key}: ${options.reason}`],
    outputs: { ...baseOutputs(state, dir), halt: state.halt }
  });
}

/** Phase steps in run order: plan, build, the internal review rounds, then the tail. */
function orderedSteps(steps) {
  const ordered = [];
  const named = (n) => latestNamed(steps, n);
  for (const name of ["plan", "build"])
    if (named(name)) ordered.push({ name, result: named(name) });
  const fixes = stepsByRound(steps, "fix-review");
  const reviews = [...stepsByRound(steps, "review").entries()].sort(
    (a, b) => a[0] - b[0]
  );
  for (const [n, s] of reviews) {
    ordered.push({ name: s.name, result: s.result });
    if (fixes.has(n))
      ordered.push({ name: fixes.get(n).name, result: fixes.get(n).result });
  }
  for (const name of [WAIT_STEP, "fix-review", "merge"])
    if (named(name)) ordered.push({ name, result: named(name) });
  return { ordered, reviews: reviews.length };
}

/**
 * Final result block. The status is the one of the last phase step that ran
 * (an earlier step that did not end done was continued past), unless the task
 * escalated, halted or a loop stopped it; merged wins over done.
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
  const named = (n) => latestNamed(steps, n);
  const { ordered, reviews } = orderedSteps(steps);
  const last = ordered.at(-1) ?? null;
  let derived = last ? last.result.status : "done";
  if (named("merge")?.status === "merged") derived = "merged";
  if (derived === "escalate") derived = "failed";
  if (state.stop) derived = state.stop.status;
  if (state.halt) derived = "halted";
  if (state.escalation) derived = "escalate";
  const carrier = last;
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
  const buildStep = named("build");
  const gates =
    buildStep?.gates ??
    (Object.keys(state.gates ?? {}).length > 0 ? state.gates : undefined);
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
    commit: headOf(projectDir),
    pr: state.pr,
    gates,
    max_risk: runRisk,
    outputs: {
      ...baseOutputs(state, dir),
      milestones: state.milestones ?? [],
      milestones_done:
        buildStep?.outputs?.milestones_done ?? Object.keys(milestoneCommits),
      milestone_commits: milestoneCommits,
      commits: commits.map((c) => c.sha),
      review_fix_commits: reviewFixCommits.length,
      files_count: files.length,
      internal_review: {
        rounds: reviews,
        max_rounds: state.internal_review_rounds,
        remaining: loop.remaining ?? null,
        exhausted: loop.exhausted ?? false
      },
      pr_rounds: state.pr_rounds,
      fix_review_wait: pick(named(WAIT_STEP)?.outputs, [
        "reviewers",
        "completed",
        "pending",
        "checks"
      ]),
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
      deferred_phases: state.stop_before_wait
        ? WAIT_PHASES.filter((p) =>
            state.skipped_phases?.[p]?.includes("stop-before-wait")
          )
        : [],
      stop: state.stop ?? undefined,
      halt: state.halt ?? undefined,
      escalation: state.escalation ?? undefined
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
  if (block.gates === undefined) delete block.gates;
  for (const key of ["stop", "halt", "escalation"])
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
      if (state.stop_before_wait && state.pr)
        return `Opened${pr}; review, fixes and merge are left to the caller.`;
      if (state.pr) return `Done ${what}${milestones}:${pr}.`;
      if (state.track === "inline")
        return `Committed ${state.commit ? state.commit.slice(0, 7) : "the change"} on ${state.branch ?? "the branch"}.`;
      return `Built ${what}${milestones} on ${state.branch ?? "the branch"}.`;
    case "halted":
      return `Halted ${what}${state.halt ? ` (${state.halt.key}): ${state.halt.reason}` : state.stop ? `: ${state.stop.reason}` : "."}`;
    case "escalate":
      return `Escalated to the orchestrated track (${state.escalation?.trigger}).`;
    case "awaiting-human":
      return `Waiting for a human on ${what}${pr}${state.stop ? `: ${state.stop.reason}` : "."}`;
    default:
      return `Failed ${what}${pr}${state.stop ? `: ${state.stop.reason}` : "."}`;
  }
}

export function cmdResult(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  if (options.status !== undefined && !RESULT_STATUSES.includes(options.status))
    throw new ShipError(
      `--status must be one of ${RESULT_STATUSES.join(", ")}`,
      2
    );
  return buildResult(dir, state, {
    status: options.status,
    summary: stringOption(options.summary) ?? undefined,
    projectDir: projectDirOf(options, state),
    runRisk: runJson(dir).max_risk ?? null
  });
}
