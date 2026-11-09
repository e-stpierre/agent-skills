#!/usr/bin/env node
// esp-skills run directories (harness contract v1, draft).
//
// Creates and updates contract-compliant run directories so no skill writes
// the JSON layouts by hand. Every artifact is validated against the schemas in
// references/contract/v1/ before it is written.
//
// Run location: --run-dir <path> when given (a harness or parent run owns it),
// otherwise <runs.root>/<YYYY-MM-DD>-<slug> from the resolved config.
// Appends to *.jsonl files and run.json updates hold `<file>.lock`.
// ESP_RUNS_NOW (ISO date-time) fixes the clock, for tests.
//
// Exit codes: 0 success, 1 invalid artifact or failed operation, 2 usage error.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome, loadConfig } from "./config.mjs";
import {
  CONTRACT_VERSION,
  RISK_ORDER,
  RUN_STATUS_EVENTS,
  TERMINAL_RUN_STATUSES,
  exitCodeFor,
  maxRisk,
  parseFrontmatter,
  validateArtifact
} from "./lib/contract.mjs";
import { withLock } from "./lib/lock.mjs";

export class RunsError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "RunsError";
    this.exitCode = exitCode;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATED_DIR = /^(\d{4}-\d{2}-\d{2})-/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Current time, overridable with ESP_RUNS_NOW. */
export function now(env = process.env) {
  if (env.ESP_RUNS_NOW) {
    const fixed = new Date(env.ESP_RUNS_NOW);
    if (Number.isNaN(fixed.getTime()))
      throw new RunsError(`Invalid ESP_RUNS_NOW: ${env.ESP_RUNS_NOW}`, 2);
    return fixed;
  }
  return new Date();
}

/** Local calendar date (YYYY-MM-DD) of a Date. */
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Turn free text into a directory-safe slug. */
export function slugify(text) {
  const slug = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (!slug) throw new RunsError("A slug with at least one letter or digit is required", 2);
  return slug;
}

function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new RunsError(`${path}: cannot read file (${err.code ?? err.message})`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new RunsError(`${path}: invalid JSON (${err.message})`);
  }
}

function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function assertArtifact(artifact, value, source) {
  const result = validateArtifact(artifact, value);
  if (!result.valid) {
    const lines = result.errors.map((e) => `  ${e.path}: ${e.message}`);
    throw new RunsError(`Invalid ${artifact} (${source}):\n${lines.join("\n")}`);
  }
}

function countLines(path) {
  if (!existsSync(path)) return 0;
  const text = readFileSync(path, "utf8");
  return text.split("\n").filter((l) => l.trim() !== "").length;
}

/**
 * Append one entry to a jsonl file under its lock. `build(lineNumber)` returns
 * the entry; it receives the 1-based number the new line will have.
 */
function appendJsonl(path, artifact, build) {
  mkdirSync(dirname(path), { recursive: true });
  return withLock(path, () => {
    const entry = build(countLines(path) + 1);
    assertArtifact(artifact, entry, path);
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  });
}

function parseJsonInput(raw, what) {
  if (raw === undefined || raw === true) {
    throw new RunsError(`${what} requires --json <object> or JSON on stdin`, 2);
  }
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("expected a JSON object");
    return value;
  } catch (err) {
    throw new RunsError(`${what}: invalid JSON input (${err.message})`, 2);
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return undefined;
  }
}

function requireRunDir(options) {
  if (!options["run-dir"]) throw new RunsError("--run-dir <path> is required", 2);
  const dir = resolve(expandHome(options["run-dir"]));
  if (!existsSync(join(dir, "run.json")))
    throw new RunsError(`Not a run directory (no run.json): ${dir}`);
  return dir;
}

function runId(dir) {
  return readJsonFile(join(dir, "run.json")).id;
}

function configFor(options) {
  return loadConfig({
    snapshot: options["config-snapshot"],
    projectDir: options["project-dir"]
  }).config;
}

/** Runs root from --root, else runs.root in the config. */
export function runsRoot(options) {
  if (options.root) return resolve(expandHome(String([options.root].flat()[0])));
  return resolve(expandHome(configFor(options).runs.root));
}

function splitList(value) {
  return [value]
    .flat()
    .filter((v) => v !== undefined && v !== true)
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Append an event to events.jsonl; `seq` is the line number. */
export function appendEvent(dir, type, data = {}, env = process.env) {
  const id = runId(dir);
  return appendJsonl(join(dir, "events.jsonl"), "event", (seq) => ({
    seq,
    at: now(env).toISOString(),
    run: id,
    type,
    data
  }));
}

/** Raise run.json max_risk to `risk` when it is higher. */
function raiseRunRisk(dir, risk, env) {
  if (!risk) return;
  const path = join(dir, "run.json");
  withLock(path, () => {
    const run = readJsonFile(path);
    const next = maxRisk(run.max_risk ?? null, risk);
    if (next === run.max_risk) return;
    run.max_risk = next;
    run.updated_at = now(env).toISOString();
    assertArtifact("run", run, path);
    writeJsonAtomic(path, run);
  });
}

const RUN_FIELDS = [
  "title",
  "workflow",
  "parent",
  "repo",
  "base",
  "branch",
  "worktree",
  "pr",
  "runtime"
];

export function cmdCreate(slugArg, options, env = process.env) {
  const at = now(env);
  let dir;
  if (options["run-dir"]) {
    dir = resolve(expandHome(options["run-dir"]));
  } else {
    const root = runsRoot(options);
    const base = `${options.date ?? localDate(at)}-${slugify(slugArg ?? options.title)}`;
    if (!DATED_DIR.test(base)) throw new RunsError(`Invalid --date: ${options.date}`, 2);
    dir = join(root, base);
    for (let n = 2; existsSync(dir); n++) dir = join(root, `${base}-${n}`);
  }
  const runPath = join(dir, "run.json");
  if (existsSync(runPath)) {
    return { run_dir: dir, id: runId(dir), created: false };
  }
  const id = basename(dir);
  if (!ID_PATTERN.test(id)) throw new RunsError(`Invalid run directory name: ${id}`, 2);
  const run = {
    contract_version: CONTRACT_VERSION,
    id,
    type: options.type ?? "skill"
  };
  for (const field of RUN_FIELDS) run[field] = options[field] ?? null;
  Object.assign(run, {
    status: "running",
    max_risk: null,
    started_at: at.toISOString(),
    updated_at: at.toISOString(),
    ended_at: null,
    models: {},
    budgets_used: {}
  });
  assertArtifact("run", run, runPath);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(runPath, run);
  appendEvent(dir, "run.started", { type: run.type, workflow: run.workflow }, env);
  return { run_dir: dir, id, created: true };
}

export function cmdGet(options) {
  return readJsonFile(join(requireRunDir(options), "run.json"));
}

function parsePairs(values, what) {
  const out = {};
  for (const pair of splitList(values)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new RunsError(`${what} expects key=value, got ${pair}`, 2);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function cmdUpdate(options, env = process.env) {
  const dir = requireRunDir(options);
  const path = join(dir, "run.json");
  let previous;
  const run = withLock(path, () => {
    const current = readJsonFile(path);
    previous = current.status;
    const next = structuredClone(current);
    for (const field of RUN_FIELDS) {
      if (options[field] !== undefined) next[field] = options[field] === "null" ? null : options[field];
    }
    if (options.type !== undefined) next.type = options.type;
    if (options["max-risk"] !== undefined)
      next.max_risk = maxRisk(next.max_risk ?? null, options["max-risk"]);
    for (const [role, spec] of Object.entries(parsePairs(options.model, "--model"))) {
      const [model, effort] = spec.split(":");
      next.models = { ...next.models, [role]: effort ? { model, effort } : { model } };
    }
    for (const [name, value] of Object.entries(parsePairs(options.budget, "--budget"))) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new RunsError(`--budget ${name} must be a number`, 2);
      next.budgets_used = { ...next.budgets_used, [name]: number };
    }
    const at = now(env).toISOString();
    if (options.status !== undefined) {
      next.status = options.status;
      next.ended_at = TERMINAL_RUN_STATUSES.includes(options.status) ? at : null;
    }
    next.updated_at = at;
    assertArtifact("run", next, path);
    writeJsonAtomic(path, next);
    return next;
  });
  if (options.status !== undefined && options.status !== previous) {
    const type =
      options.status === "running" && previous === "paused"
        ? "run.resumed"
        : RUN_STATUS_EVENTS[options.status];
    if (type) appendEvent(dir, type, { from: previous, to: options.status }, env);
  }
  return run;
}

// ---------------------------------------------------------------------------
// Decisions, events, results
// ---------------------------------------------------------------------------

/** Append a decision; fills `id` (D001, D002, ...) and `at` when missing. */
export function appendDecision(dir, input, env = process.env) {
  const entry = appendJsonl(join(dir, "decisions.jsonl"), "decision", (n) => ({
    id: input.id ?? `D${String(n).padStart(3, "0")}`,
    at: input.at ?? now(env).toISOString(),
    ...input
  }));
  raiseRunRisk(dir, entry.risk, env);
  return entry;
}

export function cmdDecision(options, env = process.env) {
  const dir = requireRunDir(options);
  const input = parseJsonInput(options.json ?? readStdin(), "decision");
  return appendDecision(dir, input, env);
}

export function cmdEvent(type, options, env = process.env) {
  if (!type) throw new RunsError("Usage: event <type> --run-dir <path> [--data <json>]", 2);
  const dir = requireRunDir(options);
  const data = options.data === undefined ? {} : parseJsonInput(options.data, "event --data");
  return appendEvent(dir, type, data, env);
}

/** Resolve a step directory name: reuse `NN-<name>` when it exists, otherwise number it. */
export function stepDirName(dir, step) {
  if (!step || !ID_PATTERN.test(step))
    throw new RunsError(`Invalid step name: ${step ?? "(missing)"}`, 2);
  if (/^\d+-/.test(step)) return step;
  const stepsDir = join(dir, "steps");
  const existing = existsSync(stepsDir)
    ? readdirSync(stepsDir).filter((d) => /^\d+-/.test(d)).sort()
    : [];
  const match = existing.filter((d) => d.replace(/^\d+-/, "") === step).at(-1);
  if (match) return match;
  const next = existing.reduce((max, d) => Math.max(max, Number.parseInt(d, 10)), 0) + 1;
  return `${String(next).padStart(2, "0")}-${step}`;
}

export function cmdResult(step, options, env = process.env) {
  const dir = requireRunDir(options);
  const input = parseJsonInput(options.json ?? readStdin(), "result");
  const block = { contract_version: CONTRACT_VERSION, ...input };
  const name = stepDirName(dir, step);
  const path = join(dir, "steps", name, "result.json");
  assertArtifact("result", block, path);
  writeJsonAtomic(path, block);
  raiseRunRisk(dir, block.max_risk, env);
  appendEvent(
    dir,
    block.status === "failed" ? "step.failed" : "step.completed",
    { step: name, status: block.status },
    env
  );
  if (block.needs_input) {
    appendEvent(dir, "needs_input", { step: name, ...block.needs_input }, env);
  }
  return { path, step: name, exit_code: exitCodeFor(block.status), line: JSON.stringify(block) };
}

// ---------------------------------------------------------------------------
// Plans, operator messages, amendments
// ---------------------------------------------------------------------------

/** Latest plan version: plan.md is version 1, plan.v<N>.md is version N. */
export function latestPlan(dir) {
  const versions = [];
  for (const file of existsSync(dir) ? readdirSync(dir) : []) {
    if (file === "plan.md") versions.push({ version: 1, path: join(dir, file) });
    const m = /^plan\.v(\d+)\.md$/.exec(file);
    if (m) versions.push({ version: Number(m[1]), path: join(dir, file) });
  }
  versions.sort((a, b) => a.version - b.version);
  const latest = versions.at(-1);
  return { path: latest?.path ?? null, version: latest?.version ?? 0, versions };
}

export function cmdPlan(options) {
  return latestPlan(requireRunDir(options));
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/** Read inbox messages sorted by file name (queue order). */
export function readMessages(dir) {
  const inbox = join(dir, "inbox");
  if (!existsSync(inbox)) return [];
  return readdirSync(inbox)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file: join(inbox, file), message: readJsonFile(join(inbox, file)) }));
}

export function cmdMessages(options) {
  const dir = requireRunDir(options);
  const all = readMessages(dir);
  return all
    .filter(({ message }) => options.all || !message.delivered_at)
    .map(({ message }) => message);
}

export function cmdSend(options, env = process.env) {
  const dir = requireRunDir(options);
  if (!options.text || options.text === true) throw new RunsError("send requires --text <message>", 2);
  const inbox = join(dir, "inbox");
  mkdirSync(inbox, { recursive: true });
  const message = withLock(inbox, () => {
    const at = now(env);
    const id = `m${String(readMessages(dir).length + 1).padStart(3, "0")}`;
    const msg = {
      id,
      at: at.toISOString(),
      from: options.from ?? "user",
      mode: options.mode ?? "next",
      text: options.text,
      target: options.target ?? (options.step ? "step" : "run")
    };
    if (options.step) msg.step = options.step;
    const path = join(inbox, `${compactTimestamp(at)}-${id}.json`);
    assertArtifact("inbox-message", msg, path);
    writeJsonAtomic(path, msg);
    return msg;
  });
  appendEvent(dir, "message.queued", { id: message.id, mode: message.mode }, env);
  return message;
}

export function cmdDeliver(ids, options, env = process.env) {
  const dir = requireRunDir(options);
  if (ids.length === 0) throw new RunsError("Usage: deliver <message-id>... --run-dir <path>", 2);
  const delivered = [];
  for (const id of ids) {
    const found = readMessages(dir).find(({ message }) => message.id === id);
    if (!found) throw new RunsError(`Unknown message: ${id}`);
    if (found.message.delivered_at) continue;
    const message = { ...found.message, delivered_at: now(env).toISOString() };
    assertArtifact("inbox-message", message, found.file);
    writeJsonAtomic(found.file, message);
    appendEvent(dir, "message.delivered", { id }, env);
    appendDecision(
      dir,
      {
        phase: options.phase ?? "operator",
        source: "operator",
        risk: "low",
        decision: message.text,
        rationale: `Operator message ${id} from ${message.from} (mode ${message.mode})`,
        refs: [id]
      },
      env
    );
    delivered.push(message);
  }
  return delivered;
}

export function cmdAmend(options, env = process.env) {
  const dir = requireRunDir(options);
  if (!options.text || options.text === true) throw new RunsError("amend requires --text <amendment>", 2);
  const affects = splitList(options.affects);
  const version =
    options["plan-version"] !== undefined
      ? Number(options["plan-version"])
      : latestPlan(dir).version;
  if (!Number.isInteger(version) || version < 2) {
    throw new RunsError(
      "amend needs plan.v<N>.md (N >= 2) on disk first, or --plan-version <N>",
      2
    );
  }
  const entry = appendJsonl(join(dir, "amendments.jsonl"), "amendment", (n) => {
    const amendment = {
      id: `A${String(n).padStart(3, "0")}`,
      at: now(env).toISOString()
    };
    if (options.from) amendment.from = options.from;
    return { ...amendment, text: options.text, affects, plan_version: version };
  });
  appendEvent(dir, "amendment.applied", { id: entry.id, plan_version: version, affects }, env);
  appendDecision(
    dir,
    {
      phase: options.phase ?? "plan",
      source: "operator",
      risk: options.risk ?? "medium",
      decision: `Amendment ${entry.id} applied as plan version ${version}`,
      rationale: entry.text,
      refs: [entry.id, ...affects]
    },
    env
  );
  return entry;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

const DEFAULT_FS = { existsSync, readdirSync, readFileSync, statSync };

function sinceFromLast(last, at) {
  const m = /^(\d+)([dwh])$/.exec(String(last));
  if (!m) throw new RunsError(`--last expects <N>d, <N>w or <N>h, got ${last}`, 2);
  const hours = { h: 1, d: 24, w: 24 * 7 }[m[2]] * Number(m[1]);
  return localDate(new Date(at.getTime() - hours * 3600 * 1000));
}

function matchesRepo(repo, wanted) {
  if (!repo) return false;
  const a = repo.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  const b = wanted.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  return a === b || a.endsWith(`/${b}`);
}

/**
 * List runs under `roots`. Date filters use directory names only; every other
 * filter reads run.json and nothing else. Child runs under `tasks/` inherit
 * the date of their parent directory.
 */
export function indexRuns(roots, filters = {}, fs = DEFAULT_FS) {
  const statuses = splitList(filters.status);
  const minRisk = filters.risk ? RISK_ORDER.indexOf(filters.risk) : -1;
  if (filters.risk && minRisk === -1)
    throw new RunsError(`--risk expects one of ${RISK_ORDER.join(", ")}`, 2);
  for (const key of ["since", "until"]) {
    if (filters[key] && !/^\d{4}-\d{2}-\d{2}$/.test(filters[key]))
      throw new RunsError(`--${key} expects YYYY-MM-DD, got ${filters[key]}`, 2);
  }
  const runs = [];
  const errors = [];

  const visit = (dir, date, parentId) => {
    const runPath = join(dir, "run.json");
    if (!fs.existsSync(runPath)) return;
    let run;
    try {
      run = JSON.parse(fs.readFileSync(runPath, "utf8").replace(/^﻿/, ""));
    } catch (err) {
      errors.push({ path: runPath, message: err.message });
      return;
    }
    const keep =
      (statuses.length === 0 || statuses.includes(run.status)) &&
      (!filters.repo || matchesRepo(run.repo, filters.repo)) &&
      (minRisk === -1 || RISK_ORDER.indexOf(run.max_risk) >= minRisk);
    if (keep) {
      runs.push({
        id: run.id,
        path: dir,
        date,
        parent: run.parent ?? parentId,
        type: run.type,
        workflow: run.workflow ?? null,
        title: run.title ?? null,
        repo: run.repo ?? null,
        branch: run.branch ?? null,
        pr: run.pr ?? null,
        status: run.status,
        max_risk: run.max_risk ?? null,
        started_at: run.started_at ?? null,
        ended_at: run.ended_at ?? null
      });
    }
    const tasks = join(dir, "tasks");
    if (fs.existsSync(tasks)) {
      for (const child of fs.readdirSync(tasks).sort()) {
        visit(join(tasks, child), date, run.id);
      }
    }
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort()) {
      const m = DATED_DIR.exec(name);
      if (!m) continue;
      const date = m[1];
      if (filters.since && date < filters.since) continue;
      if (filters.until && date > filters.until) continue;
      visit(join(root, name), date, null);
    }
  }
  runs.sort((a, b) =>
    a.date === b.date
      ? String(a.started_at ?? "").localeCompare(String(b.started_at ?? ""))
      : a.date.localeCompare(b.date)
  );
  const limited = filters.limit ? runs.slice(-Number(filters.limit)) : runs;
  return { runs: limited, errors };
}

export function cmdIndex(options, env = process.env) {
  let roots = splitList(options.root);
  if (roots.length === 0) {
    const config = configFor(options);
    roots = [...(config.recap?.roots ?? []), config.runs.root];
  }
  const resolved = [...new Set(roots.map((r) => resolve(expandHome(r))))];
  const filters = {
    since: options.since,
    until: options.until,
    repo: options.repo,
    status: options.status,
    risk: options.risk,
    limit: options.limit
  };
  if (options.last) filters.since = sinceFromLast(options.last, now(env));
  return { roots: resolved, ...indexRuns(resolved, filters) };
}

// ---------------------------------------------------------------------------
// Validation and exit codes
// ---------------------------------------------------------------------------

const JSONL_ARTIFACTS = {
  "decisions.jsonl": "decision",
  "events.jsonl": "event",
  "amendments.jsonl": "amendment"
};

/** Guess the artifact of a contract file from its name and location. */
export function artifactFor(file) {
  const name = basename(file);
  if (name === "run.json") return "run";
  if (name === "result.json") return "result";
  if (name === "summary.md") return "summary-frontmatter";
  if (JSONL_ARTIFACTS[name]) return JSONL_ARTIFACTS[name];
  if (basename(dirname(file)) === "inbox" && name.endsWith(".json")) return "inbox-message";
  return null;
}

export function validateFile(file, schemaName) {
  const path = resolve(file);
  if (!existsSync(path)) throw new RunsError(`File not found: ${path}`);
  const artifact = schemaName ?? artifactFor(path);
  if (!artifact) throw new RunsError(`Cannot infer the artifact of ${path}; pass --schema <name>`, 2);
  const errors = [];
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const check = (value, line) => {
    for (const e of validateArtifact(artifact, value).errors) {
      errors.push(line ? { line, ...e } : e);
    }
  };
  if (path.endsWith(".jsonl")) {
    let expectedSeq = 1;
    text.split("\n").forEach((raw, i) => {
      if (raw.trim() === "") return;
      let value;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        errors.push({ line: i + 1, path: "(root)", message: `invalid JSON (${err.message})` });
        return;
      }
      check(value, i + 1);
      if (artifact === "event" && value.seq !== expectedSeq) {
        errors.push({ line: i + 1, path: "seq", message: `expected ${expectedSeq}, got ${value.seq}` });
      }
      expectedSeq++;
    });
  } else if (artifact === "summary-frontmatter" && path.endsWith(".md")) {
    let data;
    try {
      data = parseFrontmatter(text);
    } catch (err) {
      errors.push({ path: "(frontmatter)", message: err.message });
    }
    if (data === null) errors.push({ path: "(frontmatter)", message: "is missing" });
    else if (data) check(data);
  } else {
    try {
      check(JSON.parse(text));
    } catch (err) {
      errors.push({ path: "(root)", message: `invalid JSON (${err.message})` });
    }
  }
  return { file: path, artifact, valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node runs.mjs <command> [args] [options]

Commands:
  create [slug]          Create a run dir (<runs.root>/<YYYY-MM-DD>-<slug>, or --run-dir) and run.json
  get                    Print run.json
  update                 Update run.json fields (--status, --pr, --branch, --max-risk, --model, --budget, ...)
  decision               Append to decisions.jsonl (--json <object> or stdin); fills id and at
  event <type>           Append to events.jsonl (--data <json>)
  result <step>          Validate a result block (--json or stdin), write steps/<NN-step>/result.json,
                         and print the block as one line (the final output line of a step)
  plan                   Print the latest plan version (plan.md = 1, plan.v<N>.md = N)
  messages               List pending inbox messages (--all includes delivered ones)
  send                   Queue an inbox message (--text, --from, --mode, --target, --step)
  deliver <id>...        Mark messages delivered and log them as operator decisions
  amend                  Append to amendments.jsonl (--text, --affects M2,M3, --plan-version <N>)
  index                  List runs (--root, --since, --until, --last 7d, --repo, --status, --risk, --limit)
  validate <file>        Validate a contract file (--schema <artifact> when it cannot be inferred)
  exit-code <status>     Print the exit code of a result status

Options:
  --run-dir <path>          Run directory (required by every command except create, index, validate, exit-code)
  --root <dir>              Runs root for create, or a root to index (repeatable)
  --config-snapshot <path>  Config snapshot used to resolve runs.root and recap.roots
  --project-dir <dir>       Project root for config resolution
  --help                    Show this help`;

const BOOLEAN_FLAGS = new Set(["all", "help"]);
const REPEATABLE = new Set(["root", "model", "budget", "affects", "status"]);

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      let value;
      if (BOOLEAN_FLAGS.has(key)) value = true;
      else if (eq !== -1) value = arg.slice(eq + 1);
      else {
        value = argv[++i];
        if (value === undefined) throw new RunsError(`--${key} requires a value`, 2);
      }
      if (REPEATABLE.has(key) && options[key] !== undefined)
        options[key] = [options[key]].flat().concat(value);
      else options[key] = value;
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function run(argv, env = process.env) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command) return { output: USAGE, exitCode: command ? 0 : 2 };
  switch (command) {
    case "create":
      return { output: cmdCreate(args[0], options, env) };
    case "get":
      return { output: cmdGet(options) };
    case "update":
      return { output: cmdUpdate(options, env) };
    case "decision":
      return { output: cmdDecision(options, env) };
    case "event":
      return { output: cmdEvent(args[0], options, env) };
    case "result": {
      const out = cmdResult(args[0], options, env);
      return { output: out.line };
    }
    case "plan":
      return { output: cmdPlan(options) };
    case "messages":
      return { output: cmdMessages(options) };
    case "send":
      return { output: cmdSend(options, env) };
    case "deliver":
      return { output: cmdDeliver(args, options, env) };
    case "amend":
      return { output: cmdAmend(options, env) };
    case "index":
      return { output: cmdIndex(options, env) };
    case "validate": {
      if (!args[0]) throw new RunsError("Usage: validate <file> [--schema <artifact>]", 2);
      const out = validateFile(args[0], options.schema);
      return { output: out, exitCode: out.valid ? 0 : 1 };
    }
    case "exit-code":
      if (!args[0]) throw new RunsError("Usage: exit-code <status>", 2);
      return { output: String(exitCodeFor(args[0])) };
    default:
      throw new RunsError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    (exitCode === 0 || typeof output !== "string" ? process.stdout : process.stderr).write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = err instanceof RunsError || err.name === "ConfigError";
    process.stderr.write(`runs error: ${known ? err.message : (err.stack ?? err)}\n`);
    process.exitCode = known ? (err.exitCode ?? 1) : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
