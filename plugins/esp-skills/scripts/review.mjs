#!/usr/bin/env node
// esp-skills review helpers for esp-review.
//
// `target` resolves what to review (local changes, a ref, a range, or a pull
// request), writes the diff to a file the read-only reviewer can open, and
// picks the review round in the run directory. `parse` reads the reviewer's
// markdown, enforces the configured minimum severity, and builds the
// contract result block, so no SKILL.md counts findings by hand.
//
// Exit codes: 0 success, 1 failure (bad review, git or gh error), 2 usage error.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "./lib/contract.mjs";

export class ReviewError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "ReviewError";
    this.exitCode = exitCode;
  }
}

export const DIMENSIONS = [
  "correctness",
  "security",
  "plan-conformance",
  "tests",
  "conventions",
  "simplification",
  "performance"
];
export const SEVERITIES = ["low", "medium", "high", "critical"];
export const CLASSES = ["A", "B-Decide", "B-Scope"];
const CLASS_ALIASES = { a: "A", "a-fix": "A", "b-decide": "B-Decide", "b-scope": "B-Scope" };
const FINDING_HEADING = /^####\s+(F\d+)\s+-\s+(.+)$/;
const SUBHEADING = /^####\s+(.+?)\s*$/;
const LOCATION = /^\s*`([^`]+)`\s*:?\s*(.*)$/;

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/**
 * Classify a target argument without touching git: `local`, `staged`,
 * `unstaged`, `pr`, `range`, or `ref` (a ref is checked later).
 */
export function classifyTarget(target) {
  const text = (target ?? "").trim();
  if (text === "") return { kind: "local" };
  if (/^staged$/i.test(text)) return { kind: "staged" };
  if (/^unstaged$/i.test(text)) return { kind: "unstaged" };
  const pr =
    /^(?:pr\s*#?|#)(\d+)$/i.exec(text) ?? /^https?:\/\/[^\s]+\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text);
  if (pr) return { kind: "pr", number: Number(pr[1]), url: text.startsWith("http") ? text : null };
  const range = /^(\S+?)(\.\.\.?)(\S+)$/.exec(text);
  if (range) return { kind: "range", base: range[1], head: range[3], dots: range[2] };
  if (/\s/.test(text)) throw new ReviewError(`Unrecognized review target: ${text}`, 2);
  return { kind: "ref", ref: text };
}

function exec(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (res.error) throw new ReviewError(`${cmd} could not run: ${res.error.message}`);
  return res;
}

function git(cwd, args, { allowFail = false } = {}) {
  const res = exec("git", ["-c", "core.quotepath=off", ...args], cwd);
  if (res.status !== 0) {
    if (allowFail) return null;
    throw new ReviewError(`git ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout;
}

/** The `gh` command; `ESP_GH_CMD` (a JSON array) replaces it, for tests. */
function gh(cwd, args, env) {
  const prefix = env.ESP_GH_CMD ? JSON.parse(env.ESP_GH_CMD) : ["gh"];
  const res = exec(prefix[0], [...prefix.slice(1), ...args], cwd);
  if (res.status !== 0) throw new ReviewError(`gh ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout;
}

function revParse(cwd, ref) {
  const out = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true });
  return out ? out.trim() : null;
}

/** The default branch: origin/HEAD, else main, else master. */
export function defaultBranch(cwd) {
  const head = git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { allowFail: true });
  if (head) return head.trim().replace(/^refs\/remotes\//, "");
  for (const name of ["main", "master", "origin/main", "origin/master"]) {
    if (revParse(cwd, name)) return name;
  }
  throw new ReviewError("Cannot find the default branch (no origin/HEAD, main or master)");
}

/** Changed files listed in a unified diff, in order, without duplicates. */
export function diffFiles(diff) {
  const files = [];
  for (const line of diff.split(/\r?\n/)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m && !files.includes(m[2])) files.push(m[2]);
  }
  return files;
}

function diffStats(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

/** Next review round in a run dir: one more than the highest `review-<N>.md`. */
export function nextRound(runDir) {
  if (!runDir || !existsSync(runDir)) return 1;
  let max = 0;
  for (const name of readdirSync(runDir)) {
    const m = /^review-(\d+)\.md$/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff"];

/** Resolve a target to `{ kind, base, head, diff, untracked, pr }`. */
export function resolveTarget(target, { cwd = process.cwd(), env = process.env } = {}) {
  const t = classifyTarget(target);
  const out = { kind: t.kind, target: (target ?? "").trim() || null, base: null, head: null, pr: null, untracked: [] };
  if (t.kind === "pr") {
    const ref = t.url ?? String(t.number);
    const view = JSON.parse(
      gh(cwd, ["pr", "view", ref, "--json", "number,title,url,baseRefName,headRefName,headRefOid"], env)
    );
    out.pr = { number: view.number, title: view.title, url: view.url, base: view.baseRefName, head: view.headRefName };
    out.base = view.baseRefName;
    out.head = view.headRefOid ?? view.headRefName;
    out.diff = gh(cwd, ["pr", "diff", ref], env);
    return out;
  }
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }) === null) {
    throw new ReviewError(`Not a git repository: ${cwd}`);
  }
  switch (t.kind) {
    case "staged":
      out.base = revParse(cwd, "HEAD");
      out.head = "index";
      out.diff = git(cwd, [...DIFF_ARGS, "--staged"]);
      return out;
    case "unstaged":
      out.base = "index";
      out.head = "working-tree";
      out.diff = git(cwd, DIFF_ARGS);
      out.untracked = untrackedFiles(cwd);
      return out;
    case "range": {
      for (const ref of [t.base, t.head]) {
        if (!revParse(cwd, ref)) throw new ReviewError(`Unknown ref in range: ${ref}`, 2);
      }
      out.base = revParse(cwd, t.base);
      out.head = revParse(cwd, t.head);
      out.diff = git(cwd, [...DIFF_ARGS, `${t.base}${t.dots}${t.head}`]);
      return out;
    }
    case "ref": {
      if (!revParse(cwd, t.ref)) throw new ReviewError(`Unknown ref: ${t.ref}`, 2);
      return branchDiff(cwd, t.ref, out);
    }
    default: {
      const dirty = git(cwd, ["status", "--porcelain"]).trim() !== "";
      if (dirty) {
        out.kind = "local";
        out.base = revParse(cwd, "HEAD");
        out.head = "working-tree";
        out.diff = out.base ? git(cwd, [...DIFF_ARGS, "HEAD"]) : git(cwd, [...DIFF_ARGS, "--staged"]);
        out.untracked = untrackedFiles(cwd);
        return out;
      }
      out.kind = "branch";
      return branchDiff(cwd, defaultBranch(cwd), out);
    }
  }
}

function branchDiff(cwd, ref, out) {
  const mergeBase = git(cwd, ["merge-base", ref, "HEAD"], { allowFail: true });
  if (!mergeBase) throw new ReviewError(`No merge base between ${ref} and HEAD`);
  out.base = mergeBase.trim();
  out.head = revParse(cwd, "HEAD");
  out.base_ref = ref;
  out.diff = git(cwd, [...DIFF_ARGS, `${ref}...HEAD`]);
  return out;
}

function untrackedFiles(cwd) {
  return git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter(Boolean);
}

/** `target` command: resolve, write the diff file, and report where the review goes. */
export function cmdTarget(target, options = {}, env = process.env) {
  const cwd = resolve(options["project-dir"] ?? process.cwd());
  const resolved = resolveTarget(target, { cwd, env });
  const runDir = options["run-dir"] ? resolve(options["run-dir"]) : null;
  if (runDir && !existsSync(join(runDir, "run.json"))) {
    throw new ReviewError(`Not a run directory (no run.json): ${runDir}`);
  }
  const round = Number(options.round ?? nextRound(runDir));
  if (!Number.isInteger(round) || round < 1) throw new ReviewError("--round must be a positive integer", 2);
  const dir = runDir ?? mkdtempSync(join(tmpdir(), "esp-review-"));
  const diffPath = options.out ? resolve(options.out) : join(dir, `review-${round}.diff`);
  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, resolved.diff);
  const files = [...new Set([...diffFiles(resolved.diff), ...resolved.untracked])];
  return {
    kind: resolved.kind,
    target: resolved.target,
    base: resolved.base,
    head: resolved.head,
    base_ref: resolved.base_ref ?? null,
    pr: resolved.pr,
    files,
    untracked: resolved.untracked,
    stats: { files: files.length, ...diffStats(resolved.diff) },
    empty: resolved.diff.trim() === "" && resolved.untracked.length === 0,
    round,
    step: `review-${round}`,
    run_dir: runDir,
    diff_path: diffPath,
    review_path: join(dir, `review-${round}.md`),
    findings_path: join(dir, `review-${round}.json`)
  };
}

// ---------------------------------------------------------------------------
// Review parsing
// ---------------------------------------------------------------------------

function normalizeClass(text) {
  return CLASS_ALIASES[text.trim().toLowerCase()] ?? null;
}

function stripResultLine(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  const last = end > 0 ? lines[end - 1].trim() : "";
  if (last.startsWith("{") && last.endsWith("}")) {
    try {
      const block = JSON.parse(last);
      if (block && typeof block === "object" && "status" in block) return { lines: lines.slice(0, end - 1), block };
    } catch {
      // Not a result block: keep the line.
    }
  }
  return { lines, block: null };
}

function parseFinding(id, meta, body, line, errors) {
  const parts = meta.split(/\s+-\s+/).map((p) => p.trim());
  const where = `line ${line} (${id})`;
  if (parts.length !== 3) {
    errors.push(`${where}: heading must be "#### ${id} - <severity> - <dimension> - <class>"`);
    return null;
  }
  const [severity, dimension, rawClass] = [parts[0].toLowerCase(), parts[1].toLowerCase(), parts[2]];
  const cls = normalizeClass(rawClass);
  if (!SEVERITIES.includes(severity)) errors.push(`${where}: unknown severity "${parts[0]}" (${SEVERITIES.join(", ")})`);
  if (!DIMENSIONS.includes(dimension)) {
    errors.push(`${where}: unknown dimension "${parts[1]}" (${DIMENSIONS.join(", ")})`);
  }
  if (!cls) errors.push(`${where}: unknown class "${rawClass}" (A, B-Decide, B-Scope)`);
  const text = body.join("\n").trim();
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const loc = LOCATION.exec(first);
  const fields = {};
  for (const l of body) {
    const m = /^\s*[-*]\s+(Evidence|Fix|Options|Recommended|Decision)\s*:\s*(.*)$/i.exec(l);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  if (!loc) errors.push(`${where}: the first line must start with the backticked location (\`path:line\`)`);
  if (!fields.fix && cls !== "B-Decide") errors.push(`${where}: missing "- Fix:" line`);
  if (cls === "B-Decide" && !fields.recommended && !fields.fix) {
    errors.push(`${where}: B-Decide findings need "- Options:" and "- Recommended:" lines`);
  }
  return {
    id,
    severity,
    dimension,
    class: cls ?? rawClass,
    location: loc ? loc[1] : null,
    title: loc ? loc[2].trim() : first.trim(),
    evidence: fields.evidence ?? null,
    fix: fields.fix ?? null,
    options: fields.options ?? null,
    recommended: fields.recommended ?? null,
    decision: fields.decision ?? null,
    body: text
  };
}

/**
 * Parse reviewer markdown into findings. Sections: an optional `### Review:`
 * header, `#### F<n> - <severity> - <dimension> - <class>` findings,
 * `#### Rejected Candidates`, and an optional trailing result block line.
 */
export function parseReview(text) {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const { lines, block } = stripResultLine(raw);
  const errors = [];
  const findings = [];
  const rejected = [];
  const spans = [];
  const header = { base: null, head: null, dimensions: null, candidates: null, rejected: null };
  let current = null;
  let fence = false;
  const seen = new Set();
  const close = (end) => {
    if (!current) return;
    if (current.kind === "finding") {
      if (seen.has(current.id)) errors.push(`duplicate finding ID ${current.id}`);
      seen.add(current.id);
      const f = parseFinding(current.id, current.meta, current.body, current.line, errors);
      if (f) {
        findings.push(f);
        spans.push({ id: f.id, start: current.start, end });
      }
    }
    current = null;
  };
  lines.forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    const review = !fence && /^###\s+Review:\s*(\S+?)\.\.\.?(\S+)\s*$/.exec(text);
    if (review) {
      header.base = review[1];
      header.head = review[2];
    }
    const dims = !fence && /^Dimensions:\s*(.+?)\.\s*(.*)$/i.exec(text);
    if (dims && !current) {
      header.dimensions = dims[1].split(/\s*,\s*/).map((d) => d.toLowerCase());
      const c = /candidates:\s*(\d+)/i.exec(dims[2]);
      const r = /rejected:\s*(\d+)/i.exec(dims[2]);
      header.candidates = c ? Number(c[1]) : null;
      header.rejected = r ? Number(r[1]) : null;
    }
    const finding = !fence && FINDING_HEADING.exec(text);
    const sub = !fence && (SUBHEADING.exec(text) || /^#{1,3}\s/.test(text));
    if (finding) {
      close(index);
      current = { kind: "finding", id: finding[1], meta: finding[2], body: [], line: index + 1, start: index };
      return;
    }
    if (sub) {
      close(index);
      if (Array.isArray(sub) && /^rejected candidates$/i.test(sub[1])) current = { kind: "rejected" };
      return;
    }
    if (!current) return;
    if (current.kind === "finding") current.body.push(text);
    else if (current.kind === "rejected") {
      const m = /^\s*[-*]\s+(.*)$/.exec(text);
      if (m) rejected.push(m[1].trim());
    }
  });
  close(lines.length);
  return { header, findings, rejected, spans, lines, block, errors };
}

const RISK_BY_SEVERITY = { critical: "high", high: "high", medium: "medium", low: "low" };

function countBy(findings, key, values) {
  const counts = Object.fromEntries(values.map((v) => [v, 0]));
  for (const f of findings) counts[f[key]] = (counts[f[key]] ?? 0) + 1;
  return counts;
}

/** Build the report and the contract result block from parsed review markdown. */
export function buildReport(parsed, { minSeverity = "low", verified = true, paths = {} } = {}) {
  if (!SEVERITIES.includes(minSeverity)) {
    throw new ReviewError(`--min-severity must be one of ${SEVERITIES.join(", ")}`, 2);
  }
  const floor = SEVERITIES.indexOf(minSeverity);
  const kept = parsed.findings.filter((f) => SEVERITIES.indexOf(f.severity) >= floor);
  const dropped = parsed.findings.filter((f) => !kept.includes(f)).map((f) => f.id);
  const order = (f) => -SEVERITIES.indexOf(f.severity);
  kept.sort((a, b) => order(a) - order(b));
  const bySeverity = countBy(kept, "severity", [...SEVERITIES].reverse());
  const byClass = countBy(kept, "class", CLASSES);
  const rejectedCount = parsed.header.rejected ?? parsed.rejected.length;
  let maxRisk = "low";
  for (const f of kept) {
    const risk = RISK_BY_SEVERITY[f.severity];
    if (["low", "medium", "high"].indexOf(risk) > ["low", "medium", "high"].indexOf(maxRisk)) maxRisk = risk;
  }
  const parts = SEVERITIES.slice()
    .reverse()
    .filter((s) => bySeverity[s] > 0)
    .map((s) => `${bySeverity[s]} ${s}`);
  const summary =
    kept.length === 0
      ? `No findings, ${rejectedCount} candidate${rejectedCount === 1 ? "" : "s"} rejected.`
      : `${kept.length} finding${kept.length === 1 ? "" : "s"} (${parts.join(", ")}), ${rejectedCount} candidate${rejectedCount === 1 ? "" : "s"} rejected.`;
  const outputs = {
    findings: kept.length,
    by_class: byClass,
    by_severity: bySeverity,
    rejected: rejectedCount,
    verified,
    min_severity: minSeverity,
    dropped: dropped.length,
    dimensions: parsed.header.dimensions,
    base: parsed.header.base,
    head: parsed.header.head
  };
  if (paths.review) outputs.review_path = paths.review;
  if (paths.findings) outputs.findings_path = paths.findings;
  const result = { contract_version: 1, status: "done", summary, max_risk: maxRisk, outputs };
  const discovered = parsed.block?.discovered_items;
  if (Array.isArray(discovered) && discovered.length > 0) result.discovered_items = discovered;
  const check = validateArtifact("result", result);
  if (!check.valid) {
    throw new ReviewError(`Result block is invalid: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
  return { valid: true, findings: kept, rejected: parsed.rejected, dropped, result };
}

/** Review markdown with dropped findings removed and the result line stripped. */
export function renderReview(parsed, dropped) {
  const remove = new Set();
  for (const span of parsed.spans) {
    if (dropped.includes(span.id)) for (let i = span.start; i < span.end; i++) remove.add(i);
  }
  const lines = parsed.lines.filter((_, i) => !remove.has(i));
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function parseBool(value, name) {
  if (value === undefined) return true;
  if (/^(true|1|yes|on)$/i.test(value)) return true;
  if (/^(false|0|no|off)$/i.test(value)) return false;
  throw new ReviewError(`--${name} must be true or false`, 2);
}

/** `parse` command. */
export function cmdParse(file, options = {}) {
  if (!file) throw new ReviewError("Usage: parse <review.md>", 2);
  const path = resolve(file);
  if (!existsSync(path)) throw new ReviewError(`No such file: ${path}`);
  const parsed = parseReview(readFileSync(path, "utf8"));
  if (parsed.errors.length > 0) {
    return { output: { valid: false, file: path, errors: parsed.errors }, exitCode: 1 };
  }
  const mdOut = options["md-out"] ? resolve(options["md-out"]) : null;
  const findingsOut = options.out ? resolve(options.out) : null;
  const report = buildReport(parsed, {
    minSeverity: options["min-severity"] ?? "low",
    verified: parseBool(options.verified, "verified"),
    paths: { review: mdOut, findings: findingsOut }
  });
  if (mdOut) writeFileSync(mdOut, renderReview(parsed, report.dropped));
  if (findingsOut) {
    writeFileSync(
      findingsOut,
      `${JSON.stringify(
        {
          review_format: 1,
          base: report.result.outputs.base,
          head: report.result.outputs.head,
          min_severity: report.result.outputs.min_severity,
          verified: report.result.outputs.verified,
          findings: report.findings,
          rejected: report.rejected
        },
        null,
        2
      )}\n`
    );
  }
  if (options.result !== undefined && parseBool(options.result, "result")) {
    return { output: JSON.stringify(report.result) };
  }
  return { output: { file: path, ...report } };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node review.mjs <command> [args] [options]

Commands:
  target [target]        Resolve what to review and write the diff file. Target: omitted
                         (local changes, else the branch against the default branch),
                         staged, unstaged, <ref>, <base>..<head>, PR <n>, #<n>, or a PR URL.
                         Prints { kind, base, head, files, empty, round, step, diff_path,
                         review_path, findings_path, ... }
  parse <review.md>      Parse reviewer markdown, apply --min-severity, and print
                         { findings, rejected, dropped, result } (exit 1 with errors when a
                         finding is malformed)

Options:
  --run-dir <path>       Write review-<N>.diff into the run dir (target); N is the next round
  --round <n>            Force the round number (target)
  --out <file>           Diff file (target) or findings JSON file (parse)
  --project-dir <dir>    Repository to review (target, default: cwd)
  --min-severity <lvl>   Drop findings below low|medium|high|critical (parse, default low)
  --verified <bool>      Whether the verify pass ran (parse, default true)
  --md-out <file>        Write the review markdown without dropped findings (parse)
  --result               Print only the result block, as one line (parse)
  --help                 Show this help

Environment:
  ESP_GH_CMD             JSON array replacing the gh command (tests)`;

const BOOLEAN_OPTIONS = new Set(["result", "help"]);

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (BOOLEAN_OPTIONS.has(key) && eq === -1) {
        options[key] = "true";
        continue;
      }
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new ReviewError(`--${key} requires a value`, 2);
      options[key] = value;
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function run(argv, env = process.env) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command) return { output: USAGE, exitCode: command ? 0 : 2 };
  switch (command) {
    case "target":
      return { output: cmdTarget(args.join(" "), options, env) };
    case "parse":
      return cmdParse(args[0], options);
    default:
      throw new ReviewError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    (exitCode === 0 || typeof output !== "string" ? process.stdout : process.stderr).write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = err instanceof ReviewError;
    process.stderr.write(`review error: ${known ? err.message : (err.stack ?? err)}\n`);
    process.exitCode = known ? err.exitCode : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
