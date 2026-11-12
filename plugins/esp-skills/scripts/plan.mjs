#!/usr/bin/env node
// esp-skills plan files (plan format 1, see references/plan-format.md).
//
// Parses the machine-consumable plans written by esp-plan into JSON, lints
// them, and compares two plan versions so an amendment never touches a
// completed milestone.
//
// Exit codes: 0 success, 1 invalid plan or failed check, 2 usage error.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
// Task lists
// ---------------------------------------------------------------------------

// A task list is a markdown file with a checkbox progress list whose items
// name work packages (`- [ ] ESH-03: Triage`) and one heading per package
// (`### ESH-03: Triage`, at any level). Each package section may carry
// `**Goal**`-style fields and Tasks, Acceptance Criteria and Validation
// lists, as subsections or bold labels.
const PACKAGE_ID = /^(?:\*\*|`)?([A-Z][A-Z0-9]*-\d+[a-z]?)\b(?:\*\*|`)?[\s:.)-]*/;
const PACKAGE_REF = /\b[A-Z][A-Z0-9]*-\d+[a-z]?\b/g;
const CHECKBOX = /^\s{0,3}[-*+]\s+\[([ xX])\]\s+(.*)$/;
const ANY_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BOLD_FIELD =
  /^\s*(?:[-*+]\s+)?\*\*([A-Za-z][A-Za-z ]*?):?\*\*:?\s*(.*)$/;
const PACKAGE_FIELDS = {
  goal: "goal",
  objective: "goal",
  complexity: "complexity",
  size: "complexity",
  depends: "depends",
  "depends on": "depends",
  dependencies: "depends",
  files: "files",
  "files changed": "files"
};
const PACKAGE_LISTS = {
  tasks: "tasks",
  steps: "tasks",
  "acceptance criteria": "acceptance",
  acceptance: "acceptance",
  validation: "validation",
  verification: "validation"
};

const stripFrontmatter = (text) =>
  text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?(?:\n|$)/, "");

/** Lines outside code fences, with their heading level when they are one. */
function markdownLines(text) {
  let fence = false;
  return stripComments(stripFrontmatter(text))
    .split(/\r?\n/)
    .map((t, i) => {
      const toggles = /^\s*(```|~~~)/.test(t);
      if (toggles) fence = !fence;
      const h = !fence && !toggles ? ANY_HEADING.exec(t) : null;
      return {
        text: t,
        line: i + 1,
        fenced: fence || toggles,
        level: h ? h[1].length : 0,
        heading: h ? h[2] : null
      };
    });
}

function splitPackageTitle(text) {
  const m = PACKAGE_ID.exec(text.trim());
  if (!m) return null;
  return { id: m[1], title: text.trim().slice(m[0].length).trim() };
}

function fileRefs(value) {
  const ticks = [...String(value).matchAll(/`([^`]+)`/g)].map((m) =>
    m[1].trim()
  );
  return ticks.length > 0 ? ticks.filter(Boolean) : splitRefs(value);
}

const cleanItem = (item) => item.replace(/^\[[ xX]\]\s+/, "").trim();

/** Fields and lists of one package section. */
function parsePackageSection(lines) {
  const out = {
    goal: null,
    complexity: null,
    depends: null,
    files: null,
    tasks: [],
    acceptance: [],
    validation: []
  };
  let list = null;
  let buffer = [];
  const flush = () => {
    if (list) out[list] = listItems(buffer).map(cleanItem).filter(Boolean);
    buffer = [];
  };
  for (const l of lines) {
    if (l.level > 0) {
      flush();
      list = PACKAGE_LISTS[l.heading.toLowerCase()] ?? null;
      continue;
    }
    const bold = l.fenced ? null : BOLD_FIELD.exec(l.text);
    const label = bold?.[1].trim().toLowerCase();
    if (bold && PACKAGE_LISTS[label] && bold[2].trim() === "") {
      flush();
      list = PACKAGE_LISTS[label];
      continue;
    }
    if (bold && PACKAGE_FIELDS[label]) {
      flush();
      list = null;
      out[PACKAGE_FIELDS[label]] = bold[2].trim();
      continue;
    }
    if (list) buffer.push(l);
  }
  flush();
  out.files = out.files ? fileRefs(out.files) : [];
  return out;
}

/**
 * Parse a task list. Returns `{ title, intro, packages, unmatched }`:
 * `packages` are the checkbox items that have a matching heading, in list
 * order, each with `{ id, title, checked, line, goal, complexity, depends,
 * files, tasks, acceptance, validation }`. `unmatched` lists checkbox IDs
 * with no heading. A file with no package is not a task list.
 */
export function parseTaskList(text) {
  const lines = markdownLines(text);
  let front = null;
  try {
    front = parseFrontmatter(text);
  } catch {
    front = null;
  }
  const h1 = lines.find((l) => l.level === 1);
  const checkboxes = [];
  for (const l of lines) {
    if (l.fenced || l.level) continue;
    const m = CHECKBOX.exec(l.text);
    const ref = m ? splitPackageTitle(m[2]) : null;
    if (ref && !checkboxes.some((c) => c.id === ref.id))
      checkboxes.push({ ...ref, checked: m[1] !== " ", line: l.line });
  }
  const headings = new Map();
  lines.forEach((l, index) => {
    if (!l.level) return;
    const ref = splitPackageTitle(l.heading);
    if (ref && !headings.has(ref.id)) headings.set(ref.id, { ...ref, index });
  });
  const packages = [];
  const unmatched = [];
  for (const box of checkboxes) {
    const heading = headings.get(box.id);
    if (!heading) {
      unmatched.push(box.id);
      continue;
    }
    const level = lines[heading.index].level;
    let end = heading.index + 1;
    while (
      end < lines.length &&
      !(lines[end].level && lines[end].level <= level)
    )
      end++;
    const section = parsePackageSection(lines.slice(heading.index + 1, end));
    packages.push({
      id: box.id,
      title: heading.title || box.title,
      checked: box.checked,
      line: lines[heading.index].line,
      ...section,
      depends:
        section.depends === null || NONE.test(section.depends.trim())
          ? []
          : [...section.depends.matchAll(PACKAGE_REF)].map((m) => m[0])
    });
  }
  let intro = "";
  if (h1) {
    const start = lines.indexOf(h1) + 1;
    const block = [];
    for (let i = start; i < lines.length && !lines[i].level; i++)
      if (!CHECKBOX.test(lines[i].text)) block.push(lines[i].text);
    intro = block.join("\n").trim();
  }
  return {
    title:
      (typeof front?.title === "string" && front.title.trim()) ||
      h1?.heading ||
      null,
    intro,
    packages,
    unmatched
  };
}

// ---------------------------------------------------------------------------
// Writing plans: import and synthesize
// ---------------------------------------------------------------------------

const yamlString = (value) => JSON.stringify(String(value));

function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const listBlock = (items, numbered = false) =>
  items.map((item, i) => `${numbered ? `${i + 1}.` : "-"} ${item}`).join("\n");

/** Render a plan in plan format 1 from plain data (see references/plan-format.md). */
export function renderPlan({
  title,
  type = "feature",
  task = null,
  source = null,
  created = localDay(),
  overview,
  context = [],
  milestones,
  risks = [],
  openQuestions = [],
  outOfScope = []
}) {
  const front = [
    "---",
    "plan_format: 1",
    `title: ${yamlString(title)}`,
    `type: ${type}`,
    "version: 1",
    ...(task ? [`task: ${yamlString(task)}`] : []),
    ...(source ? [`source: ${yamlString(source)}`] : []),
    `created: ${created}`,
    "---"
  ];
  const orNone = (items) => (items.length ? listBlock(items) : "- None");
  const sub = (heading, items, numbered) =>
    `#### ${heading}\n\n${items.length ? listBlock(items, numbered) : ""}`.trimEnd();
  const blocks = milestones.map((m) =>
    [
      `### ${m.id}: ${m.title}`,
      [
        `- **Goal**: ${m.goal}`,
        `- **Complexity**: ${m.complexity}`,
        `- **Depends**: ${m.depends.length ? m.depends.join(", ") : "none"}`,
        `- **Files**: ${m.files.map((f) => `\`${f}\``).join(", ")}`.trimEnd()
      ].join("\n"),
      sub("Tasks", m.tasks, true),
      sub("Acceptance Criteria", m.acceptance),
      sub(
        "Validation",
        m.validation.map((v) => (v.startsWith("`") ? v : `\`${v}\``))
      )
    ].join("\n\n")
  );
  return `${[
    front.join("\n"),
    `# Plan: ${title}`,
    `## Overview\n\n${overview}`,
    ...context.map((c) => `## ${c.title}\n\n${c.body}`),
    `## Milestones\n\n${blocks.join("\n\n")}`,
    `## Risks\n\n${orNone(risks)}`,
    `## Open Questions\n\n${orNone(openQuestions)}`,
    `## Out of Scope\n\n${orNone(outOfScope)}`
  ].join("\n\n")}\n`;
}

/** Order packages so each comes after the packages it depends on (stable). */
function dependencyOrder(packages) {
  const byId = new Map(packages.map((p) => [p.id, p]));
  const done = new Set();
  const visiting = new Set();
  const ordered = [];
  const visit = (p) => {
    if (done.has(p.id) || visiting.has(p.id)) return;
    visiting.add(p.id);
    for (const dep of p.depends) if (byId.has(dep)) visit(byId.get(dep));
    visiting.delete(p.id);
    done.add(p.id);
    ordered.push(p);
  };
  for (const p of packages) visit(p);
  return ordered;
}

/**
 * Convert a task list into a plan draft, with no model: one milestone per
 * unchecked package, in dependency order. Fields the source lacks stay empty,
 * so plan-lint names what is left to fill. Returns `{ markdown, milestones,
 * mapping, dropped }`.
 */
export function importTaskList(text, { source = null, type, created } = {}) {
  const list = parseTaskList(text);
  if (list.packages.length === 0)
    throw new PlanError(
      "Not a task list: no checkbox item matches a package heading"
    );
  const open = dependencyOrder(list.packages.filter((p) => !p.checked));
  const done = list.packages.filter((p) => p.checked);
  if (open.length === 0)
    throw new PlanError(
      "Nothing to import: every package of the task list is checked"
    );
  const idOf = new Map(open.map((p, i) => [p.id, `M${i + 1}`]));
  const milestones = open.map((p) => ({
    id: idOf.get(p.id),
    title: `${p.id} ${p.title}`.trim(),
    goal: p.goal || p.title || p.id,
    complexity: COMPLEXITIES.includes(p.complexity?.toLowerCase())
      ? p.complexity.toLowerCase()
      : "medium",
    depends: p.depends.filter((d) => idOf.has(d)).map((d) => idOf.get(d)),
    files: p.files,
    tasks: p.tasks,
    acceptance: p.acceptance,
    validation: p.validation.map((v) => {
      const m = /^`([^`]+)`/.exec(v);
      return m ? m[1] : v;
    })
  }));
  const title = list.title || (source ? basename(source) : "Imported tasks");
  const name = source ? basename(source) : "the task list";
  const overview = [
    list.intro,
    `Imported from ${name}: ${open.length} of ${list.packages.length} packages remain (${open.map((p) => p.id).join(", ")}).`
  ]
    .filter(Boolean)
    .join("\n\n");
  const markdown = renderPlan({
    title,
    type: PLAN_TYPES.includes(type) ? type : "feature",
    task: `Implement the remaining packages of ${name}`,
    source,
    created,
    overview,
    context: [
      {
        title: "Packages",
        body: listBlock(open.map((p) => `${idOf.get(p.id)}: ${p.id}`))
      }
    ],
    milestones,
    outOfScope: done.map((p) => `${p.id}: ${p.title} (already done)`)
  });
  return {
    markdown,
    milestones: milestones.map((m) => m.id),
    mapping: Object.fromEntries(idOf),
    dropped: done.map((p) => p.id)
  };
}

const asList = (value) =>
  value === undefined
    ? []
    : (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);

/**
 * A one-milestone plan with no model, for a request that skips planning but
 * is too large for the inline track. Without files, the milestone covers the
 * whole repository (`.`).
 */
export function synthesizePlan({
  title,
  goal,
  files = [],
  validation = [],
  tasks = [],
  acceptance = [],
  complexity = "medium",
  type = "feature",
  task = null,
  created
}) {
  if (!title || !goal)
    throw new PlanError("synthesize needs --title and --goal", 2);
  if (validation.length === 0)
    throw new PlanError(
      "synthesize needs at least one --validation <command>",
      2
    );
  if (!COMPLEXITIES.includes(complexity))
    throw new PlanError(
      `--complexity must be one of ${COMPLEXITIES.join(", ")}`,
      2
    );
  if (!PLAN_TYPES.includes(type))
    throw new PlanError(`--type must be one of ${PLAN_TYPES.join(", ")}`, 2);
  return renderPlan({
    title,
    type,
    task: task ?? goal,
    created,
    overview: `${goal}. One milestone, synthesized without a planning model.`,
    milestones: [
      {
        id: "M1",
        title,
        goal,
        complexity,
        depends: [],
        files: files.length ? files : ["."],
        tasks: tasks.length ? tasks : [goal],
        acceptance: acceptance.length ? acceptance : [goal],
        validation
      }
    ]
  });
}

/** Write a new plan: `--out <file>`, else `<run-dir>/plan.md`, else stdout. */
function writePlan(markdown, options, extra = {}) {
  const target = options.out
    ? resolve(options.out)
    : options["run-dir"]
      ? join(resolve(options["run-dir"]), "plan.md")
      : null;
  if (!target) return { output: markdown };
  if (existsSync(target))
    throw new PlanError(
      `${target} already exists: a written plan version is final`
    );
  writeFileSync(target, markdown, "utf8");
  return { output: { ...lintPlan(target), ...extra } };
}

const USAGE = `Usage: node plan.mjs <command> [args] [options]

Commands:
  parse <file>            Print the plan as JSON (exit 1 with errors when it is invalid)
  lint <file>             Check the plan format; prints { valid, errors, warnings, milestones }
  diff <previous> <next>  Compare two plan versions for an amendment; completed milestones
                          must be unchanged. Prints { changed, added, removed, affects, ... }
  tasks <file>            Parse a task list (checkbox progress list + package headings):
                          { title, packages: [{ id, title, checked, ... }], unmatched }
  import <file>           Convert a task list into a plan draft, one milestone per unchecked
                          package; prints the lint report of the written file, plus mapping
  synthesize              A one-milestone plan with no model (--title, --goal, --validation)

Options:
  --completed <M1,M2>     Completed milestone IDs (diff)
  --run-dir <path>        diff: read completed milestones from <run-dir>/state.json;
                          import, synthesize: write <run-dir>/plan.md
  --out <file>            import, synthesize: write this file (default: print the plan)
  --type <type>           import, synthesize: feature, bug or chore (default: feature)
  --title <text>          synthesize: plan and milestone title
  --goal <text>           synthesize: milestone goal
  --files <a,b>           synthesize: files of the milestone (default: . for the whole repo)
  --validation <command>  synthesize: a validation command (repeat for more)
  --task <text>           synthesize: a task (repeat for more; default: the goal)
  --acceptance <text>     synthesize: an acceptance criterion (repeat; default: the goal)
  --complexity <level>    synthesize: low, medium or high (default: medium)
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
      if (options[key] === undefined) options[key] = value;
      else options[key] = [...asList(options[key]), value];
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
    case "tasks": {
      if (!args[0]) throw new PlanError("Usage: tasks <file>", 2);
      const path = resolve(args[0]);
      if (!existsSync(path)) throw new PlanError(`File not found: ${path}`);
      return { output: parseTaskList(readFileSync(path, "utf8")) };
    }
    case "import": {
      if (!args[0])
        throw new PlanError(
          "Usage: import <file> [--run-dir <path> | --out <file>] [--type <type>]",
          2
        );
      const path = resolve(args[0]);
      if (!existsSync(path)) throw new PlanError(`File not found: ${path}`);
      const draft = importTaskList(readFileSync(path, "utf8"), {
        source: path,
        type: options.type
      });
      return writePlan(draft.markdown, options, {
        mapping: draft.mapping,
        dropped: draft.dropped
      });
    }
    case "synthesize": {
      const one = (key) =>
        options[key] === undefined ? undefined : asList(options[key]).at(-1);
      const markdown = synthesizePlan({
        title: one("title"),
        goal: one("goal"),
        files: asList(options.files).flatMap((f) => splitRefs(f)),
        validation: asList(options.validation),
        tasks: asList(options.task),
        acceptance: asList(options.acceptance),
        complexity: one("complexity") ?? "medium",
        type: one("type") ?? "feature"
      });
      return writePlan(markdown, options);
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
