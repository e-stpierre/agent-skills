// Gate commands: the configured ones, else detected from the project files.
// On top of them: the scope of the checks a builder, a verifier or a fixer
// runs (the validation commands of a milestone plus ship.gates.always, or the
// full gates), and the final-gates phase that runs the full gates once in the
// main tree after the build, before the internal review and the push.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome, loadConfig } from "../../config.mjs";
import { readPlan } from "../../plan.mjs";
import { appendDecision, now } from "../../runs.mjs";
import {
  configOf,
  parseJsonOption,
  readState,
  runDirOf,
  ShipError,
  shipSettings,
  stringOption,
  updateState
} from "./state.mjs";

export const GATE_NAMES = ["test", "lint", "typecheck", "build"];
export const GATES_SCOPES = ["milestone", "full"];
export const FINAL_GATES_RESULTS = ["pass", "fail"];
/** Fixer rounds the final gates allow before they halt with gates-exhausted. */
export const FINAL_GATES_FIX_ROUNDS = 1;

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function packageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    return "bun";
  return "npm";
}

/** Detect gate commands from the project files at `root`. */
export function detectGates(root) {
  const gates = Object.fromEntries(GATE_NAMES.map((g) => [g, null]));
  const pkgText = readText(join(root, "package.json"));
  if (pkgText) {
    let scripts = {};
    try {
      scripts = JSON.parse(pkgText).scripts ?? {};
    } catch {
      scripts = {};
    }
    const pm = packageManager(root);
    const runScript = (name) =>
      pm === "npm"
        ? name === "test"
          ? "npm test"
          : `npm run ${name}`
        : `${pm} ${name}`;
    const pick = (...names) =>
      names.find((n) => typeof scripts[n] === "string");
    for (const [gate, names] of [
      ["test", ["test"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["build", ["build"]]
    ]) {
      const name = pick(...names);
      if (name && !(gate === "test" && /no test specified/.test(scripts[name])))
        gates[gate] = runScript(name);
    }
    return gates;
  }
  const pyproject = readText(join(root, "pyproject.toml"));
  if (pyproject !== null) {
    if (/\bpytest\b/.test(pyproject) || existsSync(join(root, "tests")))
      gates.test = "uv run pytest";
    if (/\[tool\.ruff/.test(pyproject)) gates.lint = "uv run ruff check";
    if (/\[tool\.mypy/.test(pyproject)) gates.typecheck = "uv run mypy .";
    return gates;
  }
  if (existsSync(join(root, "Cargo.toml")))
    return {
      test: "cargo test",
      lint: "cargo clippy",
      typecheck: null,
      build: "cargo build"
    };
  if (existsSync(join(root, "go.mod")))
    return {
      test: "go test ./...",
      lint: "go vet ./...",
      typecheck: null,
      build: "go build ./..."
    };
  const makefile = readText(join(root, "Makefile"));
  if (makefile) {
    for (const gate of ["test", "lint", "build"])
      if (new RegExp(`^${gate}:`, "m").test(makefile))
        gates[gate] = `make ${gate}`;
  }
  return gates;
}

/** Gate commands of a project: configured first, else detected, else none. */
export function resolveGates(root, config) {
  const configured = shipSettings(config).gates ?? {};
  const detected = detectGates(root);
  const gates = {};
  const sources = {};
  for (const g of GATE_NAMES) {
    if (configured[g]) [gates[g], sources[g]] = [configured[g], "config"];
    else if (detected[g]) [gates[g], sources[g]] = [detected[g], "detected"];
    else [gates[g], sources[g]] = [null, "none"];
  }
  return { project_dir: root, gates, sources };
}

/** The gates that have a command, as `{ name: command }`. */
export function fullCommands(gates) {
  return Object.fromEntries(
    GATE_NAMES.filter((g) => gates[g]).map((g) => [g, gates[g]])
  );
}

function globRegex(ref) {
  let out = "";
  for (let i = 0; i < ref.length; i++) {
    const c = ref[i];
    if (c === "*" && ref[i + 1] === "*") {
      out += ".*";
      i++;
      if (ref[i + 1] === "/") i++;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const normalizePath = (p) =>
  String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/**
 * Whether a changed file is covered by a milestone file reference: the same
 * path, a directory that contains it, a glob that matches it, or `.`.
 */
export function matchesRef(file, ref) {
  const f = normalizePath(file);
  const r = normalizePath(ref);
  if (r === "" || r === ".") return true;
  if (/[*?]/.test(r)) return globRegex(r).test(f);
  return f === r || f.startsWith(`${r}/`);
}

/**
 * The checks of one scope, from the full gates and the validation commands.
 * `milestone` runs the validation commands (`validate-1`, `validate-2`, ...,
 * the names a verifier reports) plus the `always` gates, and falls back to
 * the full gates when there is no validation command. `full` runs every gate.
 */
export function scopeGates({
  gates,
  scope = "milestone",
  always = [],
  validation = null,
  target = null
}) {
  if (!GATES_SCOPES.includes(scope))
    throw new ShipError(
      `gates scope must be one of ${GATES_SCOPES.join(", ")}`,
      2
    );
  const full = fullCommands(gates);
  const result = (resolved, commands, fallback, reason) => ({
    scope: resolved,
    configured_scope: scope,
    target,
    commands,
    fallback,
    reason
  });
  if (scope === "full")
    return result("full", full, false, "ship.gates_scope is full");
  if (validation === null)
    return result(
      "full",
      full,
      true,
      "no milestone or files given: the full gates"
    );
  const commands = [...new Set(validation)];
  if (commands.length === 0)
    return result(
      "full",
      full,
      true,
      target?.files
        ? "no milestone of the plan covers the changed files: the full gates"
        : "the milestone has no validation command: the full gates"
    );
  const scoped = Object.fromEntries(
    commands.map((c, i) => [`validate-${i + 1}`, c])
  );
  const missing = always.filter((g) => !gates[g]);
  for (const g of always) if (gates[g]) scoped[g] = gates[g];
  return result(
    "milestone",
    scoped,
    false,
    missing.length > 0
      ? `validation commands plus ship.gates.always (no command for ${missing.join(", ")})`
      : "validation commands plus ship.gates.always"
  );
}

/** Validation commands for a milestone, or for the milestones that cover a set of files. */
function planValidation(planPath, { milestone, files }) {
  if (!planPath)
    return {
      validation: files ? [] : null,
      error: milestone ? "no plan" : null
    };
  const parsed = readPlan(planPath);
  const milestones = parsed.plan?.milestones ?? [];
  if (milestone) {
    const m = milestones.find((x) => x.id === milestone);
    if (!m) return { error: `milestone ${milestone} is not in ${planPath}` };
    return { validation: m.validation ?? [] };
  }
  const covering = milestones.filter((m) =>
    files.some((f) => (m.files ?? []).some((ref) => matchesRef(f, ref)))
  );
  return {
    validation: covering.flatMap((m) => m.validation ?? []),
    milestones: covering.map((m) => m.id)
  };
}

const listOption = (value) => {
  const text = stringOption(value);
  if (!text) return null;
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Gate commands of a project, and the checks of the requested scope: with
 * `milestone`, the checks of that milestone's builder and verifier; with
 * `files`, the checks of a fix round (the milestones covering those files).
 */
export function gatesFor({
  projectDir,
  snapshot,
  scope,
  milestone,
  files,
  planPath
} = {}) {
  const root = resolve(expandHome(String(projectDir ?? process.cwd())));
  const config = loadConfig({ snapshot, projectDir: root }).config;
  const resolved = resolveGates(root, config);
  const settings = shipSettings(config);
  const id = stringOption(milestone);
  const changed = Array.isArray(files) ? files : listOption(files);
  if (id && changed)
    throw new ShipError("gates: pass --milestone or --files, not both", 2);
  let validation = null;
  let target = null;
  if (id || changed) {
    const plan = planValidation(planPath, { milestone: id, files: changed });
    if (plan.error) throw new ShipError(`gates: ${plan.error}`);
    validation = plan.validation;
    target = id
      ? { milestone: id }
      : { files: changed, milestones: plan.milestones ?? [] };
  }
  return {
    ...resolved,
    ...scopeGates({
      gates: resolved.gates,
      scope: stringOption(scope) ?? settings.gates_scope,
      always: settings.gates_always,
      validation,
      target
    })
  };
}

// ---------------------------------------------------------------------------
// final-gates phase
// ---------------------------------------------------------------------------

function fixerModel(config) {
  const entry = config.defaults?.models?.fixer;
  if (!entry?.model) return { role: "fixer", model: "inherit" };
  return entry.effort
    ? { role: "fixer", model: entry.model, effort: entry.effort }
    : { role: "fixer", model: entry.model };
}

/** Initial final-gates state of ship.json. */
export const finalGatesState = (s) =>
  s.final_gates ?? {
    runs: 0,
    fix_rounds: 0,
    max_fix_rounds: FINAL_GATES_FIX_ROUNDS,
    last: null
  };

/**
 * What follows a final-gates run: `continue` after a pass, `fix` for the one
 * fixer round, then `halt` (gates-exhausted in halt_on) or
 * `continue-failing` (the phase is recorded failed and the run goes on).
 */
export function finalGatesAction(fg, result, haltOn) {
  if (result === "pass") return "continue";
  if (fg.fix_rounds < fg.max_fix_rounds) return "fix";
  return haltOn.includes("gates-exhausted") ? "halt" : "continue-failing";
}

/**
 * `ship.mjs final-gates --result pass|fail [--gates <json>] [--reason <text>]`:
 * record one run of the full gates in the main tree.
 */
export function cmdFinalGates(options, env = process.env) {
  const dir = runDirOf(options);
  const current = readState(dir);
  if (!current.phases.includes("final-gates"))
    throw new ShipError(
      `final-gates is not a phase of this run (${current.track} track, phases: ${current.phases.join(", ")})`
    );
  const result = stringOption(options.result);
  if (!FINAL_GATES_RESULTS.includes(result))
    throw new ShipError(
      `--result must be one of ${FINAL_GATES_RESULTS.join(", ")}`,
      2
    );
  const reason = stringOption(options.reason);
  if (result === "fail" && !reason)
    throw new ShipError("a failing final-gates run needs --reason <text>", 2);
  const gates =
    options.gates === undefined
      ? null
      : parseJsonOption(options.gates, "gates");
  const at = now(env).toISOString();
  let action = null;
  const state = updateState(
    dir,
    (s) => {
      const fg = finalGatesState(s);
      action = finalGatesAction(fg, result, s.halt_on);
      fg.runs += 1;
      if (action === "fix") fg.fix_rounds += 1;
      fg.last = { result, gates, reason, at };
      s.final_gates = fg;
      if (gates) s.gates = { ...s.gates, ...gates };
      s.phase_status["final-gates"] =
        action === "continue"
          ? "done"
          : action === "continue-failing"
            ? "failed"
            : "started";
    },
    env
  );
  const fg = state.final_gates;
  const out = {
    action,
    result,
    runs: fg.runs,
    fix_rounds: fg.fix_rounds,
    max_fix_rounds: fg.max_fix_rounds
  };
  if (action === "fix") {
    const decision = appendDecision(
      dir,
      {
        phase: "final-gates",
        source: "policy",
        risk: "medium",
        decision: `Fix the final gates (round ${fg.fix_rounds})`,
        rationale: `The full gates fail after the build: ${reason}`
      },
      env
    );
    Object.assign(out, {
      round: fg.fix_rounds,
      step: `final-gates-fix-${fg.fix_rounds}`,
      commit_title: "fix(gates): <what changed>",
      ...fixerModel(configOf(state.config_snapshot)),
      decision: decision.id
    });
  } else if (action === "halt") {
    Object.assign(out, {
      key: "gates-exhausted",
      reason: `final gates still fail after ${fg.fix_rounds} fixer round(s): ${reason}`
    });
  } else if (action === "continue-failing") {
    const decision = appendDecision(
      dir,
      {
        phase: "final-gates",
        source: "policy",
        risk: "high",
        decision: "Continue with failing final gates",
        rationale: `gates-exhausted is not in ship.halt_on: ${reason}`
      },
      env
    );
    out.decision = decision.id;
  }
  return out;
}
