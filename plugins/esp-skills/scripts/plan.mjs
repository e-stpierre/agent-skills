#!/usr/bin/env node
// esp-skills plan files (plan format 1, see references/plan-format.md).
//
// Parses the machine-consumable plans written by esp-plan into JSON, lints
// them, and compares two plan versions so an amendment never touches a
// completed milestone.
//
// Exit codes: 0 success, 1 invalid plan or failed check, 2 usage error.

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/contract.mjs";

export class PlanError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "PlanError";
    this.exitCode = exitCode;
  }
}

export const PLAN_FORMAT = 1;
export const PLAN_TYPES = ["feature", "bug", "chore"];
export const COMPLEXITIES = ["low", "medium", "high"];
const MILESTONE_ID = /^M[1-9]\d*$/;
const MILESTONE_HEADING = /^###\s+(\S+?):\s*(.*)$/;
const FIELD_LINE = /^[-*]\s+\*\*([A-Za-z][A-Za-z ]*)\*\*:\s*(.*)$/;
const LIST_ITEM = /^\s{0,1}(?:[-*+]|\d+[.)])\s+(.*)$/;
const NONE = /^(none|n\/a)\.?$/i;

// Required top-level sections, in the order they must appear.
const REQUIRED_SECTIONS = [
  "Overview",
  "Milestones",
  "Risks",
  "Open Questions",
  "Out of Scope"
];
const MILESTONE_FIELDS = {
  Goal: "goal",
  Complexity: "complexity",
  Depends: "depends",
  Files: "files"
};
const MILESTONE_LISTS = {
  Tasks: "tasks",
  "Acceptance Criteria": "acceptance",
  Validation: "validation"
};
const FRONTMATTER_KEYS = [
  "plan_format",
  "title",
  "type",
  "version",
  "task",
  "source",
  "created"
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** Split markdown into `{ title, lines }` blocks at headings of `level` (outside code fences). */
function splitHeadings(lines, level) {
  const marker = `${"#".repeat(level)} `;
  const blocks = [{ title: null, lines: [], line: 0 }];
  let fence = false;
  for (const { text, line } of lines) {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    if (!fence && text.startsWith(marker)) {
      blocks.push({ title: text.slice(marker.length).trim(), lines: [], line });
    } else {
      blocks.at(-1).lines.push({ text, line });
    }
  }
  return blocks;
}

/** Collect top-level list items; indented or wrapped lines continue the previous item. */
function listItems(lines) {
  const items = [];
  let fence = false;
  for (const { text } of lines) {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    const m = fence ? null : LIST_ITEM.exec(text);
    if (m) items.push(m[1].trim());
    else if (text.trim() !== "" && items.length > 0)
      items[items.length - 1] += `\n${text.trimEnd()}`;
  }
  return items;
}

function bodyText(lines) {
  return lines
    .map((l) => l.text)
    .join("\n")
    .trim();
}

function splitRefs(value) {
  return String(value)
    .split(/[,\s]+/)
    .map((v) => v.replace(/`/g, "").trim())
    .filter(Boolean);
}

function noneOr(items) {
  return items.length === 1 && NONE.test(items[0]) ? [] : items;
}

function parseMilestone(block, errors) {
  const heading = MILESTONE_HEADING.exec(`### ${block.title}`);
  const id = heading?.[1] ?? block.title;
  const where = `milestone ${id} (line ${block.line})`;
  if (!heading || !MILESTONE_ID.test(id)) {
    errors.push(`${where}: heading must be "### M<n>: <title>"`);
  }
  const milestone = {
    id,
    title: heading?.[2]?.trim() ?? "",
    goal: "",
    complexity: null,
    depends: [],
    files: [],
    tasks: [],
    acceptance: [],
    validation: []
  };
  if (!milestone.title) errors.push(`${where}: title is empty`);

  const [head, ...subs] = splitHeadings(block.lines, 4);
  const seen = new Set();
  let current = null;
  for (const { text } of head.lines) {
    const m = FIELD_LINE.exec(text);
    if (m) {
      const key = MILESTONE_FIELDS[m[1].trim()];
      current = null;
      if (!key) {
        errors.push(`${where}: unknown field "${m[1].trim()}"`);
        continue;
      }
      if (seen.has(key))
        errors.push(`${where}: duplicate field "${m[1].trim()}"`);
      seen.add(key);
      current = { key, value: m[2].trim() };
      milestone[key] = current.value;
    } else if (current && text.trim() !== "" && /^\s/.test(text)) {
      current.value += ` ${text.trim()}`;
      milestone[current.key] = current.value;
    } else if (text.trim() !== "") {
      current = null;
    }
  }
  for (const [label, key] of Object.entries(MILESTONE_FIELDS)) {
    if (!seen.has(key)) errors.push(`${where}: missing field "**${label}**"`);
  }
  milestone.complexity = seen.has("complexity")
    ? milestone.complexity.toLowerCase()
    : null;
  if (
    milestone.complexity !== null &&
    !COMPLEXITIES.includes(milestone.complexity)
  ) {
    errors.push(
      `${where}: complexity must be one of ${COMPLEXITIES.join(", ")}, got "${milestone.complexity}"`
    );
  }
  milestone.depends = NONE.test(String(milestone.depends).trim())
    ? []
    : splitRefs(milestone.depends);
  milestone.files = splitRefs(milestone.files);
  if (seen.has("goal") && !milestone.goal)
    errors.push(`${where}: goal is empty`);
  if (seen.has("files") && milestone.files.length === 0)
    errors.push(`${where}: files is empty`);

  const seenLists = new Set();
  for (const sub of subs) {
    const key = MILESTONE_LISTS[sub.title];
    if (!key) {
      errors.push(`${where}: unknown subsection "#### ${sub.title}"`);
      continue;
    }
    seenLists.add(key);
    milestone[key] = listItems(sub.lines);
  }
  for (const [label, key] of Object.entries(MILESTONE_LISTS)) {
    if (!seenLists.has(key))
      errors.push(`${where}: missing subsection "#### ${label}"`);
    else if (milestone[key].length === 0)
      errors.push(`${where}: "#### ${label}" has no list items`);
  }
  milestone.validation = milestone.validation.map((item) => {
    const m = /^`([^`]+)`/.exec(item);
    if (!m)
      errors.push(
        `${where}: validation item must start with a command in backticks: ${item}`
      );
    return m ? m[1] : item;
  });
  return milestone;
}

/**
 * Parse a plan document. Returns `{ plan, errors, warnings }`; `plan` is
 * best-effort even when `errors` is not empty.
 */
export function parsePlan(text, { file } = {}) {
  const errors = [];
  const warnings = [];
  let front = null;
  try {
    front = parseFrontmatter(text);
  } catch (err) {
    errors.push(`frontmatter: ${err.message}`);
  }
  if (front === null && errors.length === 0)
    errors.push("frontmatter: missing");
  front ??= {};

  for (const key of Object.keys(front)) {
    if (!FRONTMATTER_KEYS.includes(key) && !key.startsWith("x-"))
      errors.push(`frontmatter: unknown key "${key}"`);
  }
  if (front.plan_format !== PLAN_FORMAT)
    errors.push(
      `frontmatter: plan_format must be ${PLAN_FORMAT}, got ${JSON.stringify(front.plan_format ?? null)}`
    );
  if (typeof front.title !== "string" || front.title.trim() === "")
    errors.push("frontmatter: title is required");
  if (!PLAN_TYPES.includes(front.type))
    errors.push(
      `frontmatter: type must be one of ${PLAN_TYPES.join(", ")}, got ${JSON.stringify(front.type ?? null)}`
    );
  if (!Number.isInteger(front.version) || front.version < 1)
    errors.push(
      `frontmatter: version must be an integer >= 1, got ${JSON.stringify(front.version ?? null)}`
    );

  if (file) {
    const name = basename(file);
    const m = /^plan(?:\.v(\d+))?\.md$/.exec(name);
    const expected = m ? Number(m[1] ?? 1) : null;
    if (
      expected !== null &&
      Number.isInteger(front.version) &&
      front.version !== expected
    )
      errors.push(
        `frontmatter: version ${front.version} does not match the file name ${name} (version ${expected})`
      );
  }

  const body = stripComments(
    text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?(?:\n|$)/, "")
  );
  const lines = body.split(/\r?\n/).map((t, i) => ({ text: t, line: i + 1 }));
  const [preamble, ...sections] = splitHeadings(lines, 2);
  if (!preamble.lines.some((l) => /^#\s+\S/.test(l.text)))
    warnings.push("no '# <title>' heading before the first section");

  const byTitle = new Map();
  for (const section of sections) {
    if (byTitle.has(section.title))
      errors.push(`section "## ${section.title}" appears more than once`);
    byTitle.set(section.title, section);
  }
  let lastIndex = -1;
  for (const title of REQUIRED_SECTIONS) {
    const index = sections.findIndex((s) => s.title === title);
    if (index === -1) {
      errors.push(`missing section "## ${title}"`);
      continue;
    }
    if (index < lastIndex)
      errors.push(
        `section "## ${title}" is out of order (expected: ${REQUIRED_SECTIONS.join(", ")})`
      );
    lastIndex = Math.max(lastIndex, index);
  }
  if (sections.length > 0 && sections[0].title !== "Overview")
    errors.push('the first section must be "## Overview"');
  const tailStart = sections.findIndex((s) => s.title === "Milestones");
  sections.forEach((s, i) => {
    if (
      !REQUIRED_SECTIONS.includes(s.title) &&
      tailStart !== -1 &&
      i > tailStart
    )
      errors.push(
        `context section "## ${s.title}" must come before "## Milestones"`
      );
  });

  const overview = byTitle.has("Overview")
    ? bodyText(byTitle.get("Overview").lines)
    : "";
  if (byTitle.has("Overview") && !overview)
    errors.push('section "## Overview" is empty');

  const listSection = (title) => {
    if (!byTitle.has(title)) return [];
    const items = listItems(byTitle.get(title).lines);
    if (items.length === 0)
      errors.push(`section "## ${title}" needs list items, or "- None"`);
    return noneOr(items);
  };

  const milestones = [];
  if (byTitle.has("Milestones")) {
    const [intro, ...blocks] = splitHeadings(
      byTitle.get("Milestones").lines,
      3
    );
    void intro;
    for (const block of blocks) milestones.push(parseMilestone(block, errors));
    if (milestones.length === 0)
      errors.push(
        'section "## Milestones" has no "### M<n>: <title>" milestone'
      );
  }

  const ids = new Set();
  for (const m of milestones) {
    if (ids.has(m.id)) errors.push(`milestone ${m.id}: duplicate ID`);
    for (const dep of m.depends) {
      if (dep === m.id) errors.push(`milestone ${m.id}: depends on itself`);
      else if (!ids.has(dep)) {
        const later = milestones.some((x) => x.id === dep);
        errors.push(
          later
            ? `milestone ${m.id}: depends on ${dep}, which comes later (list milestones in dependency order)`
            : `milestone ${m.id}: depends on unknown milestone ${dep}`
        );
      }
    }
    ids.add(m.id);
    if (m.tasks.length > 12)
      warnings.push(
        `milestone ${m.id}: ${m.tasks.length} tasks; consider splitting it`
      );
    if (m.files.length > 20)
      warnings.push(
        `milestone ${m.id}: touches ${m.files.length} files; consider splitting it`
      );
  }

  const plan = {
    plan_format: front.plan_format ?? null,
    title: front.title ?? null,
    type: front.type ?? null,
    version: front.version ?? null,
    task: front.task ?? null,
    source: front.source ?? null,
    created: front.created ?? null,
    overview,
    context: sections
      .filter((s) => !REQUIRED_SECTIONS.includes(s.title))
      .map((s) => ({ title: s.title, body: bodyText(s.lines) })),
    milestones,
    risks: listSection("Risks"),
    open_questions: listSection("Open Questions"),
    out_of_scope: listSection("Out of Scope")
  };
  if (plan.open_questions.length > 0)
    warnings.push(
      `${plan.open_questions.length} open question(s): an autonomous build proceeds without answers`
    );
  return { plan, errors, warnings };
}

export function readPlan(file) {
  const path = resolve(file);
  if (!existsSync(path)) throw new PlanError(`File not found: ${path}`);
  return { path, ...parsePlan(readFileSync(path, "utf8"), { file: path }) };
}

/** Lint report for one plan file. */
export function lintPlan(file) {
  const { path, plan, errors, warnings } = readPlan(file);
  return {
    file: path,
    valid: errors.length === 0,
    version: plan.version,
    milestones: plan.milestones.map((m) => m.id),
    errors,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

/**
 * Completed milestone IDs from `<run-dir>/state.json`: entries of its
 * `milestones` object whose `status` is `done`.
 */
export function completedFromState(runDir) {
  const path = join(resolve(runDir), "state.json");
  if (!existsSync(path)) return [];
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new PlanError(`${path}: invalid JSON (${err.message})`);
  }
  const milestones = state?.milestones ?? {};
  return Object.entries(milestones)
    .filter(([, m]) => m?.status === "done")
    .map(([id]) => id);
}

const comparable = (m) => JSON.stringify(m);

/**
 * Compare two plan versions. Completed milestones must be present and
 * unchanged, and the new version must be the next one.
 */
export function diffPlans(previous, next, completed = []) {
  const errors = [];
  const before = new Map(previous.milestones.map((m) => [m.id, m]));
  const after = new Map(next.milestones.map((m) => [m.id, m]));
  if (
    Number.isInteger(previous.version) &&
    next.version !== previous.version + 1
  )
    errors.push(
      `new plan version must be ${previous.version + 1}, got ${next.version}`
    );
  for (const id of completed) {
    if (!before.has(id))
      errors.push(`completed milestone ${id} is not in the previous plan`);
    else if (!after.has(id))
      errors.push(`completed milestone ${id} was removed`);
    else if (comparable(before.get(id)) !== comparable(after.get(id)))
      errors.push(`completed milestone ${id} was changed`);
  }
  const unchanged = [];
  const changed = [];
  for (const [id, m] of after) {
    if (!before.has(id)) continue;
    (comparable(before.get(id)) === comparable(m) ? unchanged : changed).push(
      id
    );
  }
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return {
    from_version: previous.version,
    to_version: next.version,
    completed,
    unchanged,
    changed,
    added,
    removed,
    affects: [...changed, ...added, ...removed],
    valid: errors.length === 0,
    errors
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node plan.mjs <command> [args] [options]

Commands:
  parse <file>            Print the plan as JSON (exit 1 with errors when it is invalid)
  lint <file>             Check the plan format; prints { valid, errors, warnings, milestones }
  diff <previous> <next>  Compare two plan versions for an amendment; completed milestones
                          must be unchanged. Prints { changed, added, removed, affects, ... }

Options:
  --completed <M1,M2>     Completed milestone IDs (diff)
  --run-dir <path>        Read completed milestones from <run-dir>/state.json (diff)
  --help                  Show this help`;

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined)
        throw new PlanError(`--${key} requires a value`, 2);
      options[key] = value;
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function run(argv) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command)
    return { output: USAGE, exitCode: command ? 0 : 2 };
  switch (command) {
    case "parse": {
      if (!args[0]) throw new PlanError("Usage: parse <file>", 2);
      const { plan, errors, warnings } = readPlan(args[0]);
      if (errors.length > 0)
        return { output: { valid: false, errors, warnings }, exitCode: 1 };
      return { output: plan };
    }
    case "lint": {
      if (!args[0]) throw new PlanError("Usage: lint <file>", 2);
      const report = lintPlan(args[0]);
      return { output: report, exitCode: report.valid ? 0 : 1 };
    }
    case "diff": {
      if (!args[0] || !args[1])
        throw new PlanError(
          "Usage: diff <previous> <next> [--completed M1,M2] [--run-dir <path>]",
          2
        );
      const previous = readPlan(args[0]);
      const next = readPlan(args[1]);
      const completed = new Set(
        String(options.completed ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      );
      if (options["run-dir"])
        for (const id of completedFromState(options["run-dir"]))
          completed.add(id);
      const report = diffPlans(previous.plan, next.plan, [...completed]);
      if (next.errors.length > 0) {
        report.valid = false;
        report.errors.push(
          ...next.errors.map((e) => `${basename(next.path)}: ${e}`)
        );
      }
      return { output: report, exitCode: report.valid ? 0 : 1 };
    }
    default:
      throw new PlanError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    (exitCode === 0 || typeof output !== "string"
      ? process.stdout
      : process.stderr
    ).write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = err instanceof PlanError;
    process.stderr.write(
      `plan error: ${known ? err.message : (err.stack ?? err)}\n`
    );
    process.exitCode = known ? err.exitCode : 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
