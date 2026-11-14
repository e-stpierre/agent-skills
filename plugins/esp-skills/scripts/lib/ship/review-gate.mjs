// Plan and review modes of esp-ship, and the review gate that decides the
// internal review of review_mode auto from the real diff of the build.

import { readPlan } from "../../plan.mjs";
import { appendDecision } from "../../runs.mjs";
import { matchesRef } from "./gates.mjs";
import {
  configOf,
  lines,
  readState,
  runDirOf,
  runJson,
  ShipError,
  tryGit,
  updateState
} from "./state.mjs";

export const PLAN_MODES = ["auto", "skip", "always"];
export const REVIEW_MODES = ["auto", "internal", "pr", "both", "none"];
export const REVIEW_GATE_DEFAULTS = { max_files: 3, max_lines: 150 };

/** A mode option, its source, else the config value, else auto. */
export function modeOf(value, configured, modes, name) {
  const given = value === undefined || value === null || value === true;
  const mode = given ? (configured ?? "auto") : String(value);
  if (!modes.includes(mode))
    throw new ShipError(`--${name} must be one of ${modes.join(", ")}`, 2);
  return {
    mode,
    source: given ? (configured ? "policy" : "default") : "operator"
  };
}

/**
 * What a review mode keeps: `internal` is on, off or auto (decided after the
 * build by the review gate), `pr` is true when the bot review runs.
 * internal_review_rounds 0 removes the internal review from any mode, so
 * auto and both act like pr.
 */
export function reviewPlan(mode = "auto", rounds = 2) {
  const internal =
    rounds === 0
      ? "off"
      : mode === "auto"
        ? "auto"
        : ["internal", "both"].includes(mode)
          ? "on"
          : "off";
  const pr = ["auto", "pr", "both"].includes(mode);
  return { mode, internal, pr };
}

/** Why a review mode skipped a phase, for skipped_phases. */
export function reviewSkipReason(mode, source) {
  return source === "operator"
    ? `--review ${mode}`
    : `ship.review_mode ${mode}`;
}

/** Files and changed lines (added plus deleted) between base and HEAD. */
export function diffStats(cwd, base) {
  const files = [];
  let total = 0;
  for (const line of lines(
    tryGit(["diff", "--numstat", "--no-renames", `${base}..HEAD`], cwd)
  )) {
    const [added, deleted, ...rest] = line.split("\t");
    const changed =
      (Number.parseInt(added, 10) || 0) + (Number.parseInt(deleted, 10) || 0);
    files.push({ path: rest.join("\t"), lines: changed });
    total += changed;
  }
  return { files, lines: total };
}

/**
 * The review gate of review_mode auto. The internal review is skipped only
 * when every rule holds: the diff is within both limits, every milestone is
 * low, the run's max_risk is low, and no changed path matches always_paths.
 * An unknown complexity or risk counts as not low.
 */
export function reviewGateDecision({
  files,
  lines: changed,
  complexities,
  maxRisk,
  alwaysPaths = [],
  maxFiles = REVIEW_GATE_DEFAULTS.max_files,
  maxLines = REVIEW_GATE_DEFAULTS.max_lines
}) {
  const reasons = [];
  if (files.length > maxFiles)
    reasons.push(`${files.length} files changed (limit ${maxFiles})`);
  if (changed > maxLines)
    reasons.push(`${changed} lines changed (limit ${maxLines})`);
  const notLow = Object.entries(complexities).filter(([, c]) => c !== "low");
  if (notLow.length > 0)
    reasons.push(
      `milestones not low: ${notLow.map(([id, c]) => `${id} ${c ?? "unknown"}`).join(", ")}`
    );
  if (maxRisk !== "low") reasons.push(`max_risk is ${maxRisk ?? "unknown"}`);
  const matched = files
    .map((f) => f.path ?? f)
    .filter((path) => alwaysPaths.some((glob) => matchesRef(path, glob)));
  if (matched.length > 0)
    reasons.push(`always_paths match: ${matched.join(", ")}`);
  const skip = reasons.length === 0;
  return {
    decision: skip ? "skip" : "review",
    files: files.length,
    lines: changed,
    max_files: maxFiles,
    max_lines: maxLines,
    complexities,
    max_risk: maxRisk,
    always_paths_matched: matched,
    reasons,
    reason: skip
      ? `${files.length} file(s), ${changed} line(s) (limits ${maxFiles}, ${maxLines}), every milestone low, max_risk low, no always_paths match`
      : reasons.join("; ")
  };
}

function milestoneComplexities(planPath) {
  if (!planPath) return {};
  const parsed = readPlan(planPath);
  return Object.fromEntries(
    (parsed.plan?.milestones ?? []).map((m) => [m.id, m.complexity ?? null])
  );
}

/**
 * `ship.mjs review-gate`: decide the internal review of review_mode auto,
 * once, after the build. A skip marks the review phase skipped with its
 * reason. Every call after the first prints the recorded gate.
 */
export function cmdReviewGate(options, env = process.env) {
  const dir = runDirOf(options);
  const current = readState(dir);
  if (current.review_gate) return { recorded: false, ...current.review_gate };
  if (current.track !== "orchestrated")
    throw new ShipError(
      "review-gate is for the orchestrated track (the inline track has no internal review)",
      2
    );
  const plan = reviewPlan(
    current.review_mode ?? "auto",
    current.internal_review_rounds
  );
  if (plan.internal !== "auto")
    throw new ShipError(
      `review-gate decides review_mode auto only (the internal review is ${plan.internal})`,
      2
    );
  if (current.phase_status.review !== "pending")
    throw new ShipError(
      `review-gate runs before the review phase (review is ${current.phase_status.review})`,
      2
    );
  const config = configOf(current.config_snapshot);
  const cwd = current.worktree ?? current.project_dir;
  const { files, lines: changed } = diffStats(cwd, current.base_sha);
  const gate = reviewGateDecision({
    files,
    lines: changed,
    complexities: milestoneComplexities(current.plan_path),
    maxRisk: runJson(dir).max_risk ?? null,
    alwaysPaths: config.ship?.review?.always_paths ?? [],
    maxFiles:
      config.ship?.auto?.review_max_files ?? REVIEW_GATE_DEFAULTS.max_files,
    maxLines:
      config.ship?.auto?.review_max_lines ?? REVIEW_GATE_DEFAULTS.max_lines
  });
  const decision = appendDecision(
    dir,
    {
      phase: "review",
      source: "policy",
      risk: "low",
      decision:
        gate.decision === "skip"
          ? "Skip the internal review"
          : "Run the internal review",
      rationale: `review_mode auto: ${gate.reason}`,
      "x-esp-review-gate": {
        files: gate.files,
        lines: gate.lines,
        max_files: gate.max_files,
        max_lines: gate.max_lines,
        max_risk: gate.max_risk,
        always_paths_matched: gate.always_paths_matched
      }
    },
    env
  );
  const recorded = { ...gate, decision_id: decision.id };
  const state = updateState(
    dir,
    (s) => {
      s.review_gate = recorded;
      if (gate.decision === "skip") {
        const reason = `review gate: ${gate.reason}`;
        s.phase_status.review = "skipped";
        s.skipped_phases = { ...s.skipped_phases, review: reason };
        s.phase_reasons = { ...s.phase_reasons, review: reason };
      }
    },
    env
  );
  return { recorded: true, ...recorded, phase_status: state.phase_status };
}
