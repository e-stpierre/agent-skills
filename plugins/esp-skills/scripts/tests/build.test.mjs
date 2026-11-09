import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectGates, filesOverlap, nextStep, resolveModels } from "../build.mjs";
import { loadConfig } from "../config.mjs";
import { completedFromState } from "../plan.mjs";
import { validateFile } from "../runs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "build.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-10T12:00:00.000Z";
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);

function milestone(id, { depends = "none", files = `\`src/${id.toLowerCase()}.js\``, complexity = "low" } = {}) {
  return `### ${id}: Build ${id}

- **Goal**: ${id} works
- **Complexity**: ${complexity}
- **Depends**: ${depends}
- **Files**: ${files}

#### Tasks

1. Implement ${id}

#### Acceptance Criteria

- ${id} is tested

#### Validation

- \`npm test\`
`;
}

function planText(version, milestones) {
  return `---
plan_format: 1
title: Toy plan
type: feature
version: ${version}
---

# Plan: Toy plan

## Overview

A toy plan.

## Milestones

${milestones.join("\n")}
## Risks

- None

## Open Questions

- None

## Out of Scope

- None
`;
}

let tmp;
let home;
let project;
let runDir;

function cli(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW }
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

const build = (...args) => cli(BUILD, [...args, "--run-dir", runDir]);
const state = () => JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-build-"));
  home = join(tmp, "home");
  project = join(tmp, "project");
  mkdirSync(home);
  mkdirSync(project);
  const created = cli(RUNS, ["create", "toy", "--root", join(tmp, "runs"), "--project-dir", project]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
  writeFileSync(
    join(runDir, "plan.md"),
    planText(1, [milestone("M1"), milestone("M2", { depends: "M1" }), milestone("M3", { complexity: "high" })])
  );
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("init", () => {
  test("creates state.json from the latest plan and freezes the config", () => {
    const r = build("init", "--base", SHA1, "--project-dir", project);
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.equal(out.created, true);
    assert.deepEqual(out.added, ["M1", "M2", "M3"]);
    const s = state();
    assert.equal(s.state_format, 1);
    assert.equal(s.plan_version, 1);
    assert.equal(s.base, SHA1);
    assert.equal(s.max_retries, 2);
    assert.deepEqual(s.order, ["M1", "M2", "M3"]);
    assert.deepEqual(s.milestones.M2.depends, ["M1"]);
    assert.equal(s.milestones.M3.complexity, "high");
    assert.equal(s.milestones.M1.status, "pending");
    assert.ok(existsSync(s.config_snapshot));
    assert.equal(loadConfig({ snapshot: s.config_snapshot }).config.build.max_retries_per_milestone, 2);
  });

  test("uses a given config snapshot instead of writing one", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(snap, JSON.stringify({ version: 1, build: { max_retries_per_milestone: 0, parallel: true } }));
    assert.equal(build("init", "--config-snapshot", snap).code, 0);
    const s = state();
    assert.equal(s.config_snapshot, snap);
    assert.equal(s.max_retries, 0);
    assert.equal(s.parallel, true);
    assert.equal(existsSync(join(runDir, "config.snapshot.json")), false);
  });

  test("is idempotent and keeps progress", () => {
    build("init");
    build("start", "M1", "--base", SHA1);
    build("finish", "M1", "--status", "done", "--commit", SHA2);
    const r = build("init");
    assert.equal(r.json().created, false);
    assert.equal(state().milestones.M1.status, "done");
  });

  test("syncs with an amended plan: keeps done, adds new, drops removed", () => {
    build("init");
    build("start", "M1");
    build("finish", "M1", "--status", "done", "--commit", SHA2);
    writeFileSync(join(runDir, "plan.v2.md"), planText(2, [milestone("M1"), milestone("M2", { depends: "M1" }), milestone("M4")]));
    const r = build("init");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json().added, ["M4"]);
    assert.deepEqual(r.json().removed, ["M3"]);
    const s = state();
    assert.equal(s.plan_version, 2);
    assert.deepEqual(s.order, ["M1", "M2", "M4"]);
    assert.equal(s.milestones.M1.commit, SHA2);
  });

  test("fails when a done milestone disappears from the plan", () => {
    build("init");
    build("start", "M1");
    build("finish", "M1", "--status", "done", "--commit", SHA2);
    writeFileSync(join(runDir, "plan.v2.md"), planText(2, [milestone("M2")]));
    const r = build("init");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Completed milestone M1 is missing/);
  });

  test("fails on a plan that does not lint, and without a plan", () => {
    writeFileSync(join(runDir, "plan.md"), "# not a plan\n");
    assert.equal(build("init").code, 1);
    rmSync(join(runDir, "plan.md"));
    const r = build("init");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No plan/);
  });

  test("requires a run dir", () => {
    const r = cli(BUILD, ["init"]);
    assert.equal(r.code, 2);
  });
});

describe("milestone loop", () => {
  beforeEach(() => assert.equal(build("init", "--base", SHA1).code, 0));

  test("three milestones run in order and end with action done", () => {
    const commits = { M1: SHA1, M2: SHA2, M3: SHA3 };
    const seen = [];
    for (;;) {
      const next = build("next").json();
      if (next.action === "done") break;
      assert.equal(next.action, "run");
      seen.push(next.milestone);
      assert.equal(build("start", next.milestone).json().attempt, 1);
      assert.equal(build("finish", next.milestone, "--status", "done", "--commit", commits[next.milestone]).code, 0);
    }
    assert.deepEqual(seen, ["M1", "M2", "M3"]);
    assert.deepEqual(completedFromState(runDir).sort(), ["M1", "M2", "M3"]);
    const events = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(
      events.filter((e) => e.type === "commit.created").map((e) => e.data.milestone),
      ["M1", "M2", "M3"]
    );
    assert.equal(validateFile(join(runDir, "events.jsonl")).valid, true);
  });

  test("a failed attempt is retried with the commit to amend, then halts when exhausted", () => {
    build("start", "M1");
    build("finish", "M1", "--status", "failed", "--commit", SHA2, "--reason", "lint fails");
    let next = build("next").json();
    assert.equal(next.action, "retry");
    assert.equal(next.attempt, 2);
    assert.equal(next.amend, SHA2);
    assert.equal(next.last_failure, "lint fails");
    build("start", "M1");
    build("finish", "M1", "--status", "failed", "--reason", "lint still fails");
    build("start", "M1");
    build("finish", "M1", "--status", "failed");
    next = build("next").json();
    assert.equal(next.action, "halt");
    assert.equal(next.milestone, "M1");
    assert.match(next.reason, /after 3 attempts/);
    const r = build("start", "M1");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no attempts left/);
    const halted = build("finish", "M1", "--status", "halted", "--reason", "gates exhausted");
    assert.equal(halted.code, 0, halted.stderr);
    assert.equal(state().milestones.M1.status, "halted");
    assert.equal(state().milestones.M1.attempts, 3);
    assert.equal(build("finish", "M1", "--status", "done", "--commit", SHA1).code, 1);
  });

  test("an interrupted attempt is resumed as a retry", () => {
    build("start", "M1");
    const next = build("next").json();
    assert.equal(next.action, "retry");
    assert.equal(next.milestone, "M1");
    assert.equal(next.attempt, 2);
  });

  test("a halted milestone stops the loop", () => {
    build("start", "M1");
    build("finish", "M1", "--status", "halted", "--reason", "plan ambiguity");
    const next = build("next").json();
    assert.equal(next.action, "halt");
    assert.equal(next.reason, "plan ambiguity");
  });

  test("--milestone selects one milestone and reports blocked dependencies", () => {
    assert.equal(build("next", "--milestone", "M3").json().milestone, "M3");
    const blocked = build("next", "--milestone", "M2").json();
    assert.equal(blocked.action, "blocked");
    assert.match(blocked.reason, /depends on M1/);
    assert.equal(build("next", "--milestone", "next").json().milestone, "M1");
    assert.equal(build("next", "--milestone", "M9").code, 2);
  });

  test("finish validates its input", () => {
    assert.equal(build("finish", "M1", "--status", "done", "--commit", SHA1).code, 1);
    build("start", "M1");
    assert.equal(build("finish", "M1", "--status", "done").code, 2);
    assert.equal(build("finish", "M1", "--status", "weird").code, 2);
    assert.equal(build("finish", "M1", "--status", "done", "--commit", "nope").code, 2);
  });

  test("--parallel returns runnable milestones with disjoint files", () => {
    const next = build("next", "--parallel").json();
    assert.deepEqual(next.batch, ["M1", "M3"]);
  });
});

describe("nextStep", () => {
  const make = (entries, max = 2) => ({
    max_retries: max,
    order: Object.keys(entries),
    milestones: Object.fromEntries(
      Object.entries(entries).map(([id, m]) => [id, { status: "pending", attempts: 0, depends: [], files: [], commit: null, ...m }])
    )
  });

  test("parallel batches skip overlapping files and milestones without files", () => {
    const s = make({
      M1: { files: ["src/a.js"] },
      M2: { files: ["src/a.js"] },
      M3: { files: ["src/b"] },
      M4: { files: ["src/b/c.js"] },
      M5: { files: ["docs/x.md"] }
    });
    assert.deepEqual(nextStep(s, { parallel: true }).batch, ["M1", "M3", "M5"]);
    const noFiles = make({ M1: {}, M2: { files: ["x"] } });
    assert.deepEqual(nextStep(noFiles, { parallel: true }).batch, ["M1"]);
  });

  test("sequential mode returns one milestone", () => {
    assert.deepEqual(nextStep(make({ M1: { files: ["a"] }, M2: { files: ["b"] } })).batch, ["M1"]);
  });

  test("filesOverlap matches files, directories and path separators", () => {
    assert.equal(filesOverlap(["src\\a.js"], ["./src/a.js"]), true);
    assert.equal(filesOverlap(["src/"], ["src/x/y.js"]), true);
    assert.equal(filesOverlap(["src/ab.js"], ["src/a"]), false);
  });
});

describe("models", () => {
  test("complexity selects the builder entry, --model overrides it", () => {
    const { config } = loadConfig({ snapshot: undefined, projectDir: undefined, env: { ESP_SKILLS_HOME: "/nonexistent-esp" } });
    assert.deepEqual(resolveModels(config, "low").builder, { model: "sonnet" });
    assert.deepEqual(resolveModels(config, "high").builder, { model: "opus", effort: "high" });
    assert.deepEqual(resolveModels(config, "high", { model: "haiku" }).builder, { model: "haiku" });
    assert.deepEqual(resolveModels(config, "low").verifier, { model: "sonnet" });
    assert.deepEqual(resolveModels({ defaults: {} }, "low").builder, { model: "opus", source: "frontmatter" });
  });

  test("the CLI reads the frozen snapshot", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(snap, JSON.stringify({ version: 1, defaults: { models: { builder: { high: { model: "fable", effort: "max" } } } } }));
    build("init", "--config-snapshot", snap);
    assert.deepEqual(build("models", "M3").json().builder, { model: "fable", effort: "max" });
    assert.deepEqual(build("models", "M1").json().builder, { model: "sonnet" });
    assert.deepEqual(build("models", "M1", "--model", "opus", "--effort", "low").json().builder, { model: "opus", effort: "low" });
    assert.equal(build("models", "M1", "--model", "gpt").code, 2);
  });
});

describe("gates", () => {
  const write = (name, text) => writeFileSync(join(project, name), text);

  test("detects package.json scripts with the lockfile package manager", () => {
    write("package.json", JSON.stringify({ scripts: { test: "node --test", lint: "eslint .", "type-check": "tsc", build: "vite build" } }));
    write("pnpm-lock.yaml", "");
    assert.deepEqual(detectGates(project), { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm type-check", build: "pnpm build" });
  });

  test("npm placeholder test script is not a gate", () => {
    write("package.json", JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', lint: "x" } }));
    assert.deepEqual(detectGates(project), { test: null, lint: "npm run lint", typecheck: null, build: null });
  });

  test("detects pyproject, cargo, go and make projects", () => {
    write("pyproject.toml", "[tool.pytest.ini_options]\n[tool.ruff]\n");
    assert.deepEqual(detectGates(project), { test: "uv run pytest", lint: "uv run ruff check", typecheck: null, build: null });
    rmSync(join(project, "pyproject.toml"));
    write("go.mod", "module x\n");
    assert.equal(detectGates(project).test, "go test ./...");
    rmSync(join(project, "go.mod"));
    write("Makefile", "test:\n\techo ok\nbuild:\n\techo ok\n");
    assert.deepEqual(detectGates(project), { test: "make test", lint: null, typecheck: null, build: "make build" });
  });

  test("configured gates win over detected ones", () => {
    write("package.json", JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }));
    mkdirSync(join(project, ".esp-skills"));
    write(".esp-skills/config.json", JSON.stringify({ version: 1, build: { gates: { lint: "npm run lint:strict" } } }));
    const r = cli(BUILD, ["gates", "--project-dir", project]);
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.deepEqual(out.gates, { test: "npm test", lint: "npm run lint:strict", typecheck: null, build: null });
    assert.deepEqual(out.sources, { test: "detected", lint: "config", typecheck: "none", build: "none" });
  });
});
