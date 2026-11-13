// Triage of a request, before any branch or plan: the input kind, the plan
// source, the track, and the nothing-to-do exit. Detection is deterministic;
// for a prompt or an issue without --track, the model judges the track and
// passes it back with --judged-track. `--record` logs one decision per choice
// and writes the triage step result.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "../contract.mjs";
import { lintPlan, parseTaskList } from "../../plan.mjs";
import { appendDecision, cmdResult, latestPlan } from "../../runs.mjs";
import { loadConfig } from "../../config.mjs";
import { modeOf, PLAN_MODES } from "./review-gate.mjs";
import {
  positiveInt,
  projectDirOf,
  runDirOf,
  shipSettings,
  ShipError,
  stringOption,
  TRACKS
} from "./state.mjs";

export const INPUT_KINDS = ["plan", "task-list", "document", "prompt", "issue"];
export const PLAN_SOURCES = [
  "reuse",
  "import",
  "generate",
  "synthesize",
  "none"
];

const ISSUE_PATTERNS = [
  { re: /^#(\d+)$/, repo: () => null },
  { re: /^([\w.-]+\/[\w.-]+)#(\d+)$/, repo: (m) => m[1] },
  {
    re: /^https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)\/?(?:[#?]\S*)?$/,
    repo: (m) => m[1]
  }
];

function issueOf(text) {
  for (const { re, repo } of ISSUE_PATTERNS) {
    const m = re.exec(text);
    if (m) return { number: Number(m.at(-1)), repo: repo(m), ref: text };
  }
  return null;
}

/** The request as a file path, when it names an existing file. */
function fileOf(text, projectDir) {
  if (!text || /[\r\n]/.test(text) || text.length > 1024) return null;
  const candidates = isAbsolute(text)
    ? [text]
    : [resolve(process.cwd(), text), resolve(projectDir, text)];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile())
        return candidate;
    } catch {
      // not a readable file: try the next candidate
    }
  }
  return null;
}

function hasPlanFormat(text) {
  try {
    return parseFrontmatter(text)?.plan_format !== undefined;
  } catch {
    return false;
  }
}

/**
 * Detect the input kind of a request. Returns `{ input_kind, path, issue,
 * plan_errors, packages, unmatched }`.
 */
export function detectRequest(request, { projectDir = process.cwd() } = {}) {
  const text = String(request ?? "").trim();
  if (!text) throw new ShipError("triage needs --request <text|path|issue>", 2);
  const out = {
    input_kind: "prompt",
    path: null,
    issue: null,
    plan_errors: null,
    packages: null,
    unmatched: null
  };
  const path = fileOf(text, projectDir);
  if (path) {
    out.path = path;
    const content = readFileSync(path, "utf8");
    const lint = lintPlan(path);
    if (lint.valid) return { ...out, input_kind: "plan" };
    if (hasPlanFormat(content)) out.plan_errors = lint.errors;
    const list = parseTaskList(content);
    if (list.packages.length > 0)
      return {
        ...out,
        input_kind: "task-list",
        packages: list.packages.map((p) => ({
          id: p.id,
          title: p.title,
          checked: p.checked
        })),
        unmatched: list.unmatched
      };
    return { ...out, input_kind: "document" };
  }
  const issue = issueOf(text);
  if (issue) return { ...out, input_kind: "issue", issue };
  return out;
}

function trackOption(value, name) {
  const track = stringOption(value);
  if (track !== null && !TRACKS.includes(track))
    throw new ShipError(`--${name} must be one of ${TRACKS.join(", ")}`, 2);
  return track;
}

/**
 * Decide the plan source and the track from the detected request, the
 * operator's --track, a plan already in the run directory, and the model's
 * judgment (--judged-track with --estimate and --reason). `needs_judgment`
 * is true when only the model can pick the track. The plan mode changes a
 * prompt or an issue only: `always` puts it on the orchestrated track with a
 * generated plan, `skip` synthesizes a one-milestone plan instead of
 * generating one when the track is orchestrated.
 */
export function decide(detected, input = {}) {
  const {
    track: operatorTrack = null,
    judged = null,
    estimate = null,
    reason = null,
    runPlan = null,
    maxFiles = 10,
    planMode = "auto",
    planModeSource = "default"
  } = input;
  const kind = detected.input_kind;
  const name = detected.path ? basename(detected.path) : null;
  const result = {
    ...detected,
    nothing_to_do: false,
    plan_source: null,
    plan_path: null,
    track: null,
    track_source: null,
    needs_judgment: false,
    max_files_changed: maxFiles,
    estimate: null,
    plan_mode: planMode,
    choices: []
  };
  const choose = (choice) => result.choices.push(choice);
  const orchestrated = (why) => {
    result.track = operatorTrack ?? "orchestrated";
    result.track_source = operatorTrack ? "operator" : "policy";
    choose({
      key: "track",
      value: result.track,
      source: result.track_source,
      rationale: operatorTrack ? "--track given" : why
    });
  };

  if (kind === "plan" || runPlan) {
    if (operatorTrack === "inline")
      throw new ShipError(
        "--track inline cannot build a plan: a plan always runs on the orchestrated track",
        2
      );
    result.plan_source = "reuse";
    result.plan_path = kind === "plan" ? detected.path : runPlan;
    choose({
      key: "plan",
      value: "reuse",
      source: "policy",
      rationale:
        kind === "plan"
          ? `${name} passes plan-lint`
          : `the run directory already holds ${basename(runPlan)}`
    });
    orchestrated("a plan file runs on the orchestrated track");
    return result;
  }

  if (kind === "task-list") {
    const open = detected.packages.filter((p) => !p.checked);
    if (open.length === 0) {
      result.nothing_to_do = true;
      result.plan_source = "none";
      choose({
        key: "nothing_to_do",
        value: true,
        source: "policy",
        rationale: `every package of ${name} is checked (${detected.packages.map((p) => p.id).join(", ")})`
      });
      return result;
    }
  }

  if (kind === "task-list" || kind === "document") {
    if (operatorTrack === "inline") {
      result.track = "inline";
      result.track_source = "operator";
      result.plan_source = "none";
      choose({
        key: "track",
        value: "inline",
        source: "operator",
        rationale: "--track given"
      });
      choose({
        key: "plan",
        value: "none",
        source: "policy",
        rationale: "the inline track has no plan"
      });
      return result;
    }
    result.plan_source = "import";
    const open =
      kind === "task-list"
        ? detected.packages.filter((p) => !p.checked).map((p) => p.id)
        : [];
    choose({
      key: "plan",
      value: "import",
      source: "policy",
      rationale:
        kind === "task-list"
          ? `${name} is a task list with ${open.length} open package(s) (${open.join(", ")}): one milestone each`
          : `${name} is a design document without the plan format: convert it`
    });
    orchestrated(
      kind === "task-list"
        ? "a task list runs one milestone per open package"
        : "a design document runs as milestones"
    );
    return result;
  }

  // prompt or issue
  const modeRationale =
    planModeSource === "operator"
      ? `--plan ${planMode}`
      : `ship.plan_mode ${planMode}`;
  if (planMode === "always") {
    if (operatorTrack === "inline")
      throw new ShipError(
        "--plan always generates a plan, which runs on the orchestrated track: drop --track inline",
        2
      );
    result.track = "orchestrated";
    result.track_source = operatorTrack
      ? "operator"
      : planModeSource === "operator"
        ? "operator"
        : "policy";
    result.plan_source = "generate";
    choose({
      key: "track",
      value: "orchestrated",
      source: result.track_source,
      rationale: operatorTrack
        ? "--track given"
        : `${modeRationale} plans every task`
    });
    choose({
      key: "plan",
      value: "generate",
      source: planModeSource === "operator" ? "operator" : "policy",
      rationale: `${modeRationale}: a generated plan even for a small ${kind}`
    });
    return result;
  }
  const track = operatorTrack ?? judged;
  if (!track) {
    result.needs_judgment = true;
    return result;
  }
  result.track = track;
  result.track_source = operatorTrack ? "operator" : "agent";
  if (!operatorTrack) {
    if (estimate === null || !reason)
      throw new ShipError(
        "--judged-track needs --estimate <files> and --reason <text>",
        2
      );
    if (track === "inline" && estimate > maxFiles)
      throw new ShipError(
        `the inline track allows ${maxFiles} changed files (ship.inline.max_files_changed), the estimate is ${estimate}: judge orchestrated`
      );
    result.estimate = estimate;
  }
  choose({
    key: "track",
    value: track,
    source: result.track_source,
    rationale: operatorTrack
      ? "--track given"
      : `${estimate} file(s) estimated (limit ${maxFiles}): ${reason}`
  });
  const skip = planMode === "skip";
  result.plan_source =
    track === "inline" ? "none" : skip ? "synthesize" : "generate";
  choose({
    key: "plan",
    value: result.plan_source,
    source:
      skip && track !== "inline" && planModeSource === "operator"
        ? "operator"
        : "policy",
    rationale:
      track === "inline"
        ? "the inline track has no plan"
        : skip
          ? `${modeRationale}: no planning model, a one-milestone plan for the ${kind}`
          : `a ${kind} on the orchestrated track needs a generated plan`
  });
  return result;
}

const DECISION_TEXT = {
  plan: {
    reuse: "Reuse the plan file",
    import: "Import the request into a plan",
    generate: "Generate a plan with esp-plan",
    synthesize: "Synthesize a one-milestone plan",
    none: "No plan"
  },
  track: {
    inline: "Inline track",
    orchestrated: "Orchestrated track"
  }
};

function summaryOf(result) {
  if (result.nothing_to_do)
    return `Nothing to do: every package of ${basename(result.path)} is already checked.`;
  return `Triage: ${result.input_kind} on the ${result.track} track, plan ${result.plan_source}.`;
}

function existingTriage(dir) {
  const steps = join(dir, "steps");
  if (!existsSync(steps)) return null;
  const name = readdirSync(steps)
    .filter((d) => /^\d+-triage$/.test(d))
    .sort()
    .at(-1);
  const path = name && join(steps, name, "result.json");
  return path && existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
    : null;
}

function settingsFor(options, projectDir) {
  try {
    const snapshot = stringOption(options["config-snapshot"]);
    const { config } = loadConfig(
      snapshot ? { snapshot: resolve(snapshot) } : { projectDir }
    );
    return {
      ...shipSettings(config, "inline"),
      plan_mode: config.ship?.plan_mode
    };
  } catch (err) {
    if (err.name === "ConfigError")
      throw new ShipError(err.message, err.exitCode ?? 1);
    throw err;
  }
}

/**
 * `ship.mjs triage`: detect and decide. With --record (needs --run-dir), log
 * one decision per choice and write the `triage` step result; a second
 * --record prints the recorded result without logging again.
 */
export function cmdTriage(options, env = process.env) {
  const record = Boolean(options.record);
  const dir = options["run-dir"] || record ? runDirOf(options) : null;
  if (record) {
    const existing = existingTriage(dir);
    if (existing) return { recorded: false, result: existing };
  }
  const projectDir = projectDirOf(options, null);
  const settings = settingsFor(options, projectDir);
  const planMode = modeOf(
    options["plan-mode"],
    settings.plan_mode,
    PLAN_MODES,
    "plan-mode"
  );
  const detected = detectRequest(options.request, { projectDir });
  const result = decide(detected, {
    track: trackOption(options.track, "track"),
    judged: trackOption(options["judged-track"], "judged-track"),
    estimate:
      options.estimate === undefined
        ? null
        : positiveInt(options.estimate, "estimate", 0),
    reason: stringOption(options.reason),
    runPlan: dir ? latestPlan(dir).path : null,
    maxFiles: settings.max_files_changed,
    planMode: planMode.mode,
    planModeSource: planMode.source
  });
  if (!record) return result;
  if (result.needs_judgment)
    throw new ShipError(
      "triage --record on a prompt or an issue needs --track, or --judged-track with --estimate and --reason",
      2
    );
  const decisions = result.choices.map((c) =>
    appendDecision(
      dir,
      {
        phase: "triage",
        source: c.source,
        risk: "low",
        decision:
          c.key === "nothing_to_do"
            ? "Nothing to do"
            : DECISION_TEXT[c.key][c.value],
        rationale: `${c.rationale} (input: ${result.input_kind})`,
        ...(c.key === "track" && result.estimate !== null
          ? { "x-esp-estimate": result.estimate }
          : {})
      },
      env
    )
  );
  const { choices, ...facts } = result;
  void choices;
  const block = {
    status: "done",
    summary: summaryOf(result),
    max_risk: "low",
    outputs: { ...facts, decisions: decisions.map((d) => d.id) }
  };
  const written = cmdResult(
    "triage",
    { "run-dir": dir, json: JSON.stringify(block) },
    env
  );
  return {
    recorded: true,
    result: block,
    step: written.step,
    line: written.line
  };
}
