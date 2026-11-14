// The inline track: the escalation limits (files changed, gate failures) and
// the move to the orchestrated track. In a run esp-ship owns, the move is an
// in-place track switch: the branch and the uncommitted work stay. In a
// caller-owned run, `escalate` saves the work and ends with status escalate
// (exit 30), so the caller decides.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendDecision, now } from "../../runs.mjs";
import { applyTrack } from "./phases.mjs";
import { assertBlock, baseOutputs } from "./tail.mjs";
import {
  changedFiles,
  commitsSince,
  configOf,
  ESCALATION_TRIGGERS,
  git,
  isDirty,
  projectDirOf,
  readState,
  runDirOf,
  runJson,
  ShipError,
  skipUnfinished,
  stringOption,
  updateState,
  workingPatch
} from "./state.mjs";

/** How an inline run leaves its track: in place when esp-ship owns the run. */
export const escalateWith = (state) =>
  state.run_owner === "caller" ? "escalate" : "switch-track";

function escalationAction(state) {
  return state.escalate ? "escalate" : "continue-over-limit";
}

/** Compare the changed files (or an estimate) with the inline max_files_changed. */
export function scopeCheck(state, files, estimate = null) {
  const count = estimate ?? files.length;
  const exceeded = count > state.max_files_changed;
  const action = exceeded ? escalationAction(state) : "continue";
  const out = {
    files,
    count: files.length,
    estimate,
    max_files_changed: state.max_files_changed,
    exceeded,
    action
  };
  if (action === "escalate") out.escalate_with = escalateWith(state);
  return out;
}

export function cmdScope(options) {
  const dir = runDirOf(options);
  const state = readState(dir);
  let estimate = null;
  if (options.estimate !== undefined) {
    estimate = Number(options.estimate);
    if (!Number.isInteger(estimate) || estimate < 0)
      throw new ShipError("--estimate must be an integer >= 0", 2);
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
  return state.escalate ? "escalate" : "halt";
}

export function cmdGateFailure(options, env = process.env) {
  const dir = runDirOf(options);
  const state = updateState(
    dir,
    (s) => {
      s.gate_failures += 1;
      if (stringOption(options.reason))
        s.gate_failure_reasons = [
          ...(s.gate_failure_reasons ?? []),
          String(options.reason)
        ];
    },
    env
  );
  const action = gateFailureAction(state);
  const out = {
    gate_failures: state.gate_failures,
    limit: state.gate_failure_limit,
    action
  };
  if (action === "escalate") out.escalate_with = escalateWith(state);
  return out;
}

function escalationInput(options) {
  const trigger = options.trigger;
  if (!ESCALATION_TRIGGERS.includes(trigger))
    throw new ShipError(
      `--trigger must be one of ${ESCALATION_TRIGGERS.join(", ")}`,
      2
    );
  const reason = stringOption(options.reason);
  if (!reason) throw new ShipError("escalating needs --reason <text>", 2);
  return { trigger, reason };
}

function assertInline(state, command) {
  if (state.track !== "inline")
    throw new ShipError(
      `${command}: the run is on the ${state.track} track, not inline`
    );
  if (state.escalation)
    throw new ShipError(
      `Already escalated (${state.escalation.trigger}): ${state.escalation.reason}`
    );
}

function logEscalation(dir, state, { trigger, reason, files, decision }, env) {
  return appendDecision(
    dir,
    {
      phase:
        state.phase_status.implement === "pending" ? "context" : "implement",
      source: trigger === "design" ? "agent" : "policy",
      risk: "medium",
      decision,
      rationale: `Escalate: ${reason}`,
      files,
      "x-esp-escalation": trigger
    },
    env
  );
}

/**
 * Switch an owned inline run to the orchestrated track, in place: the branch,
 * the commits and the uncommitted work stay, the phases both tracks share keep
 * their progress, and the orchestrated phases start from the plan.
 */
export function cmdSwitchTrack(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const to = stringOption(options.to) ?? "orchestrated";
  if (to !== "orchestrated")
    throw new ShipError(
      "--to must be orchestrated (inline -> orchestrated)",
      2
    );
  const { trigger, reason } = escalationInput(options);
  assertInline(state, "switch-track");
  if (state.run_owner === "caller")
    throw new ShipError(
      "The caller owns this run: use escalate, so the caller decides"
    );
  const files = changedFiles(projectDirOf(options, state), state.base_sha);
  const decision = logEscalation(
    dir,
    state,
    {
      trigger,
      reason,
      files,
      decision: `Switch to the orchestrated track (${trigger})`
    },
    env
  );
  const at = now(env).toISOString();
  const updated = updateState(
    dir,
    (s) => {
      s.track_history = [
        ...(s.track_history ?? []),
        {
          from: "inline",
          to,
          trigger,
          reason,
          decision: decision.id,
          at,
          phase_status: s.phase_status
        }
      ];
      s.escalated_from = {
        track: "inline",
        trigger,
        reason,
        files,
        patch: null,
        stash: null,
        decision: decision.id,
        in_place: true
      };
      applyTrack(s, to, configOf(s.config_snapshot));
    },
    env
  );
  return {
    track: updated.track,
    from: "inline",
    trigger,
    decision: decision.id,
    files,
    phases: updated.phases,
    phase_status: updated.phase_status,
    next: updated.phases.find((p) =>
      ["pending", "started"].includes(updated.phase_status[p])
    )
  };
}

/**
 * Escalate a caller-owned inline run: save the work as a patch, stash it
 * (unless --keep-tree), log the decision and build the escalate block.
 */
export function cmdEscalate(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const { trigger, reason } = escalationInput(options);
  assertInline(state, "escalate");
  if (state.run_owner !== "caller")
    throw new ShipError(
      "esp-ship owns this run: use switch-track to move to the orchestrated track in place"
    );
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
    const message = `esp-ship escalation ${runJson(dir).id}`;
    git(["stash", "push", "--include-untracked", "-m", message], projectDir);
    stash = message;
  }
  const decision = logEscalation(
    dir,
    state,
    {
      trigger,
      reason,
      files,
      decision: `Escalate to the orchestrated track (${trigger})`
    },
    env
  );
  const escalation = {
    trigger,
    reason,
    question: stringOption(options.question),
    files,
    patch,
    stash,
    commits: commitsSince(projectDir, state.base_sha).map((c) => c.sha),
    decision: decision.id,
    at: now(env).toISOString()
  };
  const fresh = updateState(
    dir,
    (s) => {
      s.escalation = escalation;
      skipUnfinished(s);
    },
    env
  );
  return assertBlock({
    contract_version: 1,
    status: "escalate",
    summary: `Escalated to the orchestrated track (${trigger}): ${reason}`,
    files_changed: files,
    commit: null,
    pr: state.pr,
    max_risk: runJson(dir).max_risk ?? "medium",
    outputs: {
      ...baseOutputs(fresh, dir),
      escalation,
      next: {
        skill: "esp-ship",
        run_dir: dir,
        track: "orchestrated",
        resume: true
      }
    }
  });
}
