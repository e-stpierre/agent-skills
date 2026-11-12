import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  finalGatesAction,
  matchesRef,
  scopeGates
} from "../lib/ship/gates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "ship.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-08T12:00:00.000Z";

let tmp;
let home;
let repo;
let runDir;

function cli(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW }
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout)
  };
}

const ship = (...args) => cli(SCRIPT, [...args, "--run-dir", runDir]);
const ok = (...args) => {
  const r = ship(...args);
  assert.equal(r.code, 0, r.stderr);
  return r.json();
};
const state = () => JSON.parse(readFileSync(join(runDir, "ship.json"), "utf8"));
const decisions = () =>
  existsSync(join(runDir, "decisions.jsonl"))
    ? readFileSync(join(runDir, "decisions.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function git(...args) {
  const r = spawnSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args],
    { cwd: repo, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function milestone(id, files, validation) {
  return `### ${id}: Build ${id}

- **Goal**: ${id} works
- **Complexity**: low
- **Depends**: none
- **Files**: ${files.map((f) => `\`${f}\``).join(", ")}

#### Tasks

1. Implement ${id}

#### Acceptance Criteria

- ${id} is tested

#### Validation

${validation.map((v) => `- \`${v}\``).join("\n")}
`;
}

function writePlan() {
  const path = join(runDir, "plan.md");
  writeFileSync(
    path,
    `---
plan_format: 1
title: Toy plan
type: feature
version: 1
---

# Plan: Toy plan

## Overview

A toy plan.

## Milestones

${milestone("M1", ["src/auth/login.js"], ["node --test test/login.test.js"])}
${milestone("M2", ["src/api/**"], ["node --test test/api.test.js", "pnpm lint"])}
## Risks

- None

## Open Questions

- None

## Out of Scope

- None
`
  );
  return path;
}

function writeConfig(ship) {
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ version: 1, ship })
  );
}

function init(track = "orchestrated") {
  return ok(
    "init",
    "--request",
    "Add OAuth login",
    "--track",
    track,
    "--base",
    "main",
    "--project-dir",
    repo
  );
}

/** An orchestrated run whose plan, branch and build are done. */
function built() {
  init();
  writePlan();
  for (const p of ["plan", "branch", "build"])
    ok("phase", p, "--status", "done");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-ship-gates-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  writeConfig({
    gates: { typecheck: "pnpm tsc --noEmit", always: ["typecheck"] }
  });
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } })
  );
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-qm", "init");
  const created = cli(RUNS, [
    "create",
    "oauth",
    "--root",
    join(tmp, "runs"),
    "--workflow",
    "esp-ship",
    "--project-dir",
    repo
  ]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("scopeGates", () => {
  const gates = {
    test: "pnpm test",
    lint: "pnpm lint",
    typecheck: "tsc",
    build: null
  };

  test("milestone: the validation commands plus the always gates", () => {
    const out = scopeGates({
      gates,
      always: ["typecheck"],
      validation: [
        "node --test a.test.js",
        "node --test a.test.js",
        "pnpm lint"
      ]
    });
    assert.equal(out.scope, "milestone");
    assert.equal(out.fallback, false);
    assert.deepEqual(out.commands, {
      "validate-1": "node --test a.test.js",
      "validate-2": "pnpm lint",
      typecheck: "tsc"
    });
  });

  test("an always gate without a command is named, not run", () => {
    const out = scopeGates({ gates, always: ["build"], validation: ["x"] });
    assert.deepEqual(out.commands, { "validate-1": "x" });
    assert.match(out.reason, /no command for build/);
  });

  test("falls back to the full gates without a validation command", () => {
    const out = scopeGates({ gates, always: ["typecheck"], validation: [] });
    assert.equal(out.scope, "full");
    assert.equal(out.fallback, true);
    assert.deepEqual(out.commands, {
      test: "pnpm test",
      lint: "pnpm lint",
      typecheck: "tsc"
    });
    assert.equal(scopeGates({ gates }).fallback, true);
  });

  test("full scope ignores the validation commands", () => {
    const out = scopeGates({ gates, scope: "full", validation: ["x"] });
    assert.equal(out.scope, "full");
    assert.equal(out.fallback, false);
    assert.equal(out.commands["validate-1"], undefined);
    assert.throws(() => scopeGates({ gates, scope: "some" }), /scope/);
  });
});

describe("matchesRef", () => {
  test("paths, directories, globs and the whole tree", () => {
    assert.equal(matchesRef("src/a.js", "src/a.js"), true);
    assert.equal(matchesRef("src/api/x/y.js", "src/api"), true);
    assert.equal(matchesRef("src/apix.js", "src/api"), false);
    assert.equal(matchesRef("src/api/x/y.js", "src/api/**"), true);
    assert.equal(matchesRef("src/api/y.ts", "src/api/*.js"), false);
    assert.equal(matchesRef("src\\api\\y.js", "./src/api/*.js"), true);
    assert.equal(matchesRef("anything", "."), true);
  });
});

describe("milestone gates", () => {
  test("--milestone scopes to its validation commands and the always gates", () => {
    built();
    const out = ok(
      "milestone",
      "gates",
      "--milestone",
      "M2",
      "--project-dir",
      repo
    );
    assert.equal(out.scope, "milestone");
    assert.deepEqual(out.target, { milestone: "M2" });
    assert.deepEqual(out.commands, {
      "validate-1": "node --test test/api.test.js",
      "validate-2": "pnpm lint",
      typecheck: "pnpm tsc --noEmit"
    });
    assert.equal(out.gates.test, "pnpm test");
    assert.equal(out.sources.typecheck, "config");
  });

  test("--files scopes a fix round to the milestones covering the files", () => {
    built();
    const out = ok(
      "milestone",
      "gates",
      "--files",
      "src/api/routes/users.js,README.md",
      "--project-dir",
      repo
    );
    assert.deepEqual(out.target.milestones, ["M2"]);
    assert.equal(out.commands["validate-1"], "node --test test/api.test.js");
    const none = ok(
      "milestone",
      "gates",
      "--files",
      "README.md",
      "--project-dir",
      repo
    );
    assert.equal(none.scope, "full");
    assert.equal(none.fallback, true);
    assert.match(none.reason, /no milestone/);
  });

  test("--scope full and ship.gates_scope full run the full gates", () => {
    built();
    const forced = ok(
      "milestone",
      "gates",
      "--milestone",
      "M1",
      "--scope",
      "full",
      "--project-dir",
      repo
    );
    assert.equal(forced.scope, "full");
    assert.deepEqual(Object.keys(forced.commands), [
      "test",
      "lint",
      "typecheck"
    ]);
    const plain = cli(SCRIPT, ["milestone", "gates", "--project-dir", repo]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(plain.json().scope, "full");
  });

  test("an unknown milestone is an error", () => {
    built();
    const r = ship(
      "milestone",
      "gates",
      "--milestone",
      "M9",
      "--project-dir",
      repo
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /M9/);
  });
});

describe("final-gates phase", () => {
  test("runs after the build, before the review, in the main session", () => {
    built();
    const next = ok("next");
    assert.equal(next.phase, "final-gates");
    assert.equal(next.role, null);
    assert.equal(next.skill, null);
    assert.deepEqual(next.commands, {
      test: "pnpm test",
      lint: "pnpm lint",
      typecheck: "pnpm tsc --noEmit"
    });
    assert.equal(next.fix_rounds, 0);
  });

  test("a pass records the gates and moves on to the review", () => {
    built();
    const out = ok(
      "final-gates",
      "--result",
      "pass",
      "--gates",
      '{"test":"pass"}'
    );
    assert.equal(out.action, "continue");
    assert.equal(state().phase_status["final-gates"], "done");
    assert.deepEqual(state().gates, { test: "pass" });
    assert.equal(ok("next").phase, "review");
  });

  test("a failure gets one fixer round, then halts with gates-exhausted", () => {
    built();
    const fix = ok("final-gates", "--result", "fail", "--reason", "lint fails");
    assert.equal(fix.action, "fix");
    assert.equal(fix.round, 1);
    assert.equal(fix.role, "fixer");
    assert.equal(fix.step, "final-gates-fix-1");
    assert.match(fix.commit_title, /^fix\(gates\)/);
    assert.equal(state().phase_status["final-gates"], "started");
    const again = ok("next");
    assert.equal(again.phase, "final-gates");
    assert.equal(again.resumed, true);
    assert.equal(again.fix_rounds, 1);
    const halt = ok(
      "final-gates",
      "--result",
      "fail",
      "--reason",
      "lint fails"
    );
    assert.equal(halt.action, "halt");
    assert.equal(halt.key, "gates-exhausted");
    assert.match(halt.reason, /1 fixer round/);
    assert.deepEqual(
      decisions().map((d) => d.decision),
      ["Fix the final gates (round 1)"]
    );
  });

  test("a pass after the fixer round completes the phase", () => {
    built();
    ok("final-gates", "--result", "fail", "--reason", "tests fail");
    const out = ok("final-gates", "--result", "pass");
    assert.equal(out.action, "continue");
    assert.equal(out.runs, 2);
    assert.equal(state().phase_status["final-gates"], "done");
  });

  test("without gates-exhausted in halt_on, the run continues with the phase failed", () => {
    writeConfig({ halt_on: ["budget"] });
    built();
    ok("final-gates", "--result", "fail", "--reason", "tests fail");
    const out = ok("final-gates", "--result", "fail", "--reason", "tests fail");
    assert.equal(out.action, "continue-failing");
    assert.equal(state().phase_status["final-gates"], "failed");
    assert.equal(
      decisions().at(-1).decision,
      "Continue with failing final gates"
    );
    assert.equal(ok("next").phase, "review");
  });

  test("usage errors and the inline track", () => {
    built();
    assert.equal(ship("final-gates", "--result", "maybe").code, 2);
    assert.equal(ship("final-gates", "--result", "fail").code, 2);
    rmSync(join(runDir, "ship.json"));
    init("inline");
    const r = ship("final-gates", "--result", "pass");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a phase of this run/);
  });

  test("a configured phase list without final-gates skips it", () => {
    writeConfig({ phases: ["plan", "branch", "build", "review", "pr"] });
    init();
    assert.equal(state().phase_status["final-gates"], "skipped");
  });
});
