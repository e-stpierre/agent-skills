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
import { resolvePhases } from "../lib/ship/phases.mjs";
import {
  modeOf,
  PLAN_MODES,
  reviewGateDecision,
  reviewPlan
} from "../lib/ship/review-gate.mjs";
import { decide } from "../lib/ship/triage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "ship.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-08T12:00:00.000Z";
const ALWAYS = ["**/auth/**", "**/migrations/**", ".github/workflows/**"];

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

function commit(path, lineCount = 1) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(
    full,
    `${Array.from({ length: lineCount }, (_, i) => `line ${i}`).join("\n")}\n`
  );
  git("add", ".");
  git("commit", "-qm", `Add ${path}`);
}

function writePlan(complexities = ["low"]) {
  const milestones = complexities
    .map(
      (c, i) => `### M${i + 1}: Build part ${i + 1}

- **Goal**: part ${i + 1} works
- **Complexity**: ${c}
- **Depends**: none
- **Files**: \`src/part${i + 1}.js\`

#### Tasks

1. Implement part ${i + 1}

#### Acceptance Criteria

- part ${i + 1} is tested

#### Validation

- \`node --test\`
`
    )
    .join("\n");
  writeFileSync(
    join(runDir, "plan.md"),
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

${milestones}
## Risks

- None

## Open Questions

- None

## Out of Scope

- None
`
  );
}

function writeConfig(ship) {
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ version: 1, ship })
  );
}

function init(...extra) {
  return ok(
    "init",
    "--request",
    "Add a flag",
    "--base",
    "main",
    "--project-dir",
    repo,
    ...extra
  );
}

const setRisk = (risk) =>
  assert.equal(
    cli(RUNS, ["update", "--run-dir", runDir, "--max-risk", risk]).code,
    0
  );

/** An orchestrated run on auto whose plan, branch, build and final gates are done. */
function built(complexities = ["low"], ...extra) {
  init(...extra);
  writePlan(complexities);
  for (const p of ["plan", "branch", "build", "final-gates"])
    ok("phase", p, "--status", "done");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-ship-review-gate-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  writeConfig({ review: { always_paths: ALWAYS } });
  writeFileSync(join(repo, "README.md"), "toy\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-qm", "init");
  const created = cli(RUNS, [
    "create",
    "flag",
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

describe("modes", () => {
  test("reviewPlan: what each review mode keeps", () => {
    assert.deepEqual(reviewPlan("auto"), {
      mode: "auto",
      internal: "auto",
      pr: true
    });
    assert.deepEqual(reviewPlan("internal"), {
      mode: "internal",
      internal: "on",
      pr: false
    });
    assert.deepEqual(reviewPlan("pr"), {
      mode: "pr",
      internal: "off",
      pr: true
    });
    assert.deepEqual(reviewPlan("both"), {
      mode: "both",
      internal: "on",
      pr: true
    });
    assert.deepEqual(reviewPlan("none"), {
      mode: "none",
      internal: "off",
      pr: false
    });
  });

  test("internal_review_rounds 0 acts like pr", () => {
    for (const mode of ["auto", "both", "pr"])
      assert.deepEqual(
        { ...reviewPlan(mode, 0), mode: "pr" },
        reviewPlan("pr", 2)
      );
    assert.equal(reviewPlan("internal", 0).internal, "off");
  });

  test("modeOf: operator, config, then auto; unknown values are usage errors", () => {
    assert.deepEqual(modeOf("skip", "always", PLAN_MODES, "plan-mode"), {
      mode: "skip",
      source: "operator"
    });
    assert.deepEqual(modeOf(undefined, "always", PLAN_MODES, "plan-mode"), {
      mode: "always",
      source: "policy"
    });
    assert.deepEqual(modeOf(undefined, undefined, PLAN_MODES, "plan-mode"), {
      mode: "auto",
      source: "default"
    });
    assert.throws(
      () => modeOf("never", undefined, PLAN_MODES, "plan-mode"),
      /--plan-mode must be one of/
    );
  });

  test("resolvePhases: each review mode skips its phases with a reason", () => {
    const run = (
      reviewMode,
      reviewSource = "operator",
      track = "orchestrated"
    ) => resolvePhases(track, undefined, { reviewMode, reviewSource }).skipped;
    assert.deepEqual(run("auto"), {});
    assert.deepEqual(run("both"), {});
    assert.deepEqual(run("pr"), { review: "--review pr" });
    assert.deepEqual(run("internal"), { "fix-review": "--review internal" });
    assert.deepEqual(run("none"), {
      review: "--review none",
      "fix-review": "--review none"
    });
    assert.deepEqual(run("pr", "policy"), { review: "ship.review_mode pr" });
    assert.deepEqual(run("internal", "operator", "inline"), {
      "fix-review": "--review internal"
    });
    assert.deepEqual(
      resolvePhases("orchestrated", undefined, { reviewRounds: 0 }).skipped,
      { review: "internal_review_rounds is 0" }
    );
    assert.throws(
      () => resolvePhases("orchestrated", undefined, { reviewMode: "x" }),
      /--review-mode must be one of/
    );
  });
});

describe("init", () => {
  test("--review-mode none skips both reviews in ship.json, with the reason in the result", () => {
    init("--review-mode", "none", "--plan-mode", "skip");
    const s = state();
    assert.equal(s.review_mode, "none");
    assert.equal(s.review_mode_source, "operator");
    assert.equal(s.plan_mode, "skip");
    assert.equal(s.phase_status.review, "skipped");
    assert.equal(s.phase_status["fix-review"], "skipped");
    assert.equal(s.phase_status.merge, "pending");
    assert.equal(s.skipped_phases.review, "--review none");
    const result = ship("result").json();
    assert.equal(result.outputs.skipped_phases["fix-review"], "--review none");
    assert.equal(result.outputs.review_mode, "none");
    assert.equal(result.outputs.plan_mode, "skip");
  });

  test("ship.review_mode from the config is a policy reason", () => {
    writeConfig({ review_mode: "internal" });
    init();
    const s = state();
    assert.equal(s.review_mode_source, "policy");
    assert.equal(s.skipped_phases["fix-review"], "ship.review_mode internal");
    assert.equal(s.phase_status.review, "pending");
  });

  test("an unknown mode is a usage error", () => {
    const r = ship(
      "init",
      "--request",
      "x",
      "--project-dir",
      repo,
      "--review-mode",
      "sometimes"
    );
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--review-mode must be one of/);
  });

  test("internal_review_rounds 0 skips the review and never asks for the gate", () => {
    writeConfig({ internal_review_rounds: 0 });
    built();
    const next = ok("next");
    assert.equal(next.phase, "pr");
    assert.equal(state().skipped_phases.review, "internal_review_rounds is 0");
  });
});

describe("plan dispatch", () => {
  test("reuse and synthesize need no model, import runs on sonnet", () => {
    init("--plan-source", "synthesize");
    let next = ok("next");
    assert.equal(next.phase, "plan");
    assert.equal(next.plan_source, "synthesize");
    assert.equal(next.plan_mode, "auto");
    assert.equal(next.model, null);
    assert.equal(next.skill, null);
    rmSync(join(runDir, "ship.json"));
    init("--plan-source", "import");
    next = ok("next");
    assert.equal(next.model, "sonnet");
    assert.equal(next.skill, "esp-plan");
    assert.equal(next.role, "planner");
  });
});

describe("reviewGateDecision", () => {
  const base = {
    files: [{ path: "src/a.js", lines: 10 }],
    lines: 10,
    complexities: { M1: "low" },
    maxRisk: "low",
    alwaysPaths: ALWAYS
  };
  const files = (n) =>
    Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.js`, lines: 1 }));

  test("a small low-risk diff skips the internal review", () => {
    const out = reviewGateDecision(base);
    assert.equal(out.decision, "skip");
    assert.deepEqual(out.reasons, []);
    assert.match(out.reason, /1 file\(s\), 10 line\(s\)/);
  });

  test("thresholds are inclusive: 3 files and 150 lines skip, one more reviews", () => {
    assert.equal(
      reviewGateDecision({ ...base, files: files(3), lines: 150 }).decision,
      "skip"
    );
    const many = reviewGateDecision({ ...base, files: files(4) });
    assert.equal(many.decision, "review");
    assert.match(many.reason, /4 files changed \(limit 3\)/);
    const long = reviewGateDecision({ ...base, lines: 151 });
    assert.equal(long.decision, "review");
    assert.match(long.reason, /151 lines changed \(limit 150\)/);
  });

  test("configured thresholds apply", () => {
    assert.equal(
      reviewGateDecision({ ...base, files: files(5), maxFiles: 5 }).decision,
      "skip"
    );
    assert.equal(
      reviewGateDecision({ ...base, lines: 20, maxLines: 10 }).decision,
      "review"
    );
  });

  test("a milestone that is not low reviews", () => {
    const out = reviewGateDecision({
      ...base,
      complexities: { M1: "low", M2: "medium", M3: null }
    });
    assert.equal(out.decision, "review");
    assert.match(out.reason, /M2 medium, M3 unknown/);
  });

  test("a high or unknown max_risk never skips", () => {
    for (const maxRisk of ["medium", "high", "critical", null])
      assert.equal(reviewGateDecision({ ...base, maxRisk }).decision, "review");
  });

  test("always_paths override the thresholds", () => {
    for (const path of [
      "src/auth/token.js",
      "auth/login.js",
      "db/migrations/001.sql",
      ".github/workflows/ci.yml"
    ]) {
      const out = reviewGateDecision({
        ...base,
        files: [{ path, lines: 1 }],
        lines: 1
      });
      assert.equal(out.decision, "review", path);
      assert.deepEqual(out.always_paths_matched, [path]);
    }
    assert.equal(
      reviewGateDecision({
        ...base,
        files: [{ path: "src/author.js", lines: 1 }]
      }).decision,
      "skip"
    );
  });
});

describe("review-gate command", () => {
  test("next asks for the gate; a skip marks the review skipped and logs one policy decision", () => {
    built();
    commit("src/part1.js", 20);
    setRisk("low");
    assert.equal(ok("next").action, "review-gate");
    const gate = ok("review-gate");
    assert.equal(gate.recorded, true);
    assert.equal(gate.decision, "skip");
    assert.equal(gate.files, 1);
    assert.equal(gate.lines, 20);
    const s = state();
    assert.equal(s.phase_status.review, "skipped");
    assert.match(s.skipped_phases.review, /^review gate: 1 file\(s\), 20 line/);
    assert.equal(s.review_gate.decision_id, gate.decision_id);
    const logged = decisions().filter((d) => d.phase === "review");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].source, "policy");
    assert.equal(logged[0].decision, "Skip the internal review");
    assert.equal(logged[0]["x-esp-review-gate"].lines, 20);
    assert.equal(ok("next").phase, "pr");
    const again = ok("review-gate");
    assert.equal(again.recorded, false);
    assert.equal(decisions().filter((d) => d.phase === "review").length, 1);
    const result = ship("result").json();
    assert.match(result.outputs.skipped_phases.review, /^review gate/);
    assert.equal(result.outputs.review_gate.decision, "skip");
  });

  test("an always_paths match keeps the review", () => {
    built();
    commit("src/auth/session.js", 3);
    setRisk("low");
    const gate = ok("review-gate");
    assert.equal(gate.decision, "review");
    assert.deepEqual(gate.always_paths_matched, ["src/auth/session.js"]);
    assert.equal(state().phase_status.review, "pending");
    const next = ok("next");
    assert.equal(next.phase, "review");
    assert.equal(next.sub, "review");
  });

  test("a high-risk run never skips, even with a tiny diff", () => {
    built();
    commit("src/part1.js", 1);
    setRisk("high");
    const gate = ok("review-gate");
    assert.equal(gate.decision, "review");
    assert.match(gate.reason, /max_risk is high/);
  });

  test("a medium milestone keeps the review", () => {
    built(["low", "medium"]);
    commit("src/part1.js", 1);
    setRisk("low");
    assert.equal(ok("review-gate").decision, "review");
  });

  test("refused on the inline track and when the mode is not auto", () => {
    init("--track", "inline");
    let r = ship("review-gate");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /orchestrated track/);
    rmSync(join(runDir, "ship.json"));
    built(["low"], "--review-mode", "both");
    r = ship("review-gate");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /review_mode auto only/);
    assert.equal(ok("next").sub, "review");
  });
});

describe("triage plan modes", () => {
  const prompt = { input_kind: "prompt", path: null, packages: [] };
  const plan = { input_kind: "plan", path: "/x/plan.md", packages: [] };
  const choice = (result, key) => result.choices.find((c) => c.key === key);

  test("always plans a prompt on the orchestrated track, with no judgment", () => {
    const out = decide(prompt, {
      planMode: "always",
      planModeSource: "operator"
    });
    assert.equal(out.needs_judgment, false);
    assert.equal(out.track, "orchestrated");
    assert.equal(out.track_source, "operator");
    assert.equal(out.plan_source, "generate");
    assert.match(choice(out, "plan").rationale, /--plan always/);
    const policy = decide(prompt, {
      planMode: "always",
      planModeSource: "policy"
    });
    assert.equal(policy.track_source, "policy");
    assert.match(choice(policy, "plan").rationale, /ship\.plan_mode always/);
  });

  test("always with --track inline is a usage error", () => {
    assert.throws(
      () => decide(prompt, { planMode: "always", track: "inline" }),
      (err) => err.exitCode === 2
    );
  });

  test("skip synthesizes a plan on the orchestrated track and keeps inline as is", () => {
    const orchestrated = decide(prompt, {
      planMode: "skip",
      planModeSource: "operator",
      judged: "orchestrated",
      estimate: 14,
      reason: "many files"
    });
    assert.equal(orchestrated.plan_source, "synthesize");
    assert.equal(choice(orchestrated, "plan").source, "operator");
    const inline = decide(prompt, {
      planMode: "skip",
      judged: "inline",
      estimate: 2,
      reason: "small"
    });
    assert.equal(inline.plan_source, "none");
    assert.equal(decide(prompt, { planMode: "skip" }).needs_judgment, true);
  });

  test("a plan file is reused in every mode", () => {
    for (const planMode of PLAN_MODES)
      assert.equal(decide(plan, { planMode }).plan_source, "reuse");
  });

  test("ship.mjs triage --plan-mode always on a prompt", () => {
    const out = ok(
      "triage",
      "--request",
      "Add a flag",
      "--plan-mode",
      "always",
      "--project-dir",
      repo
    );
    assert.equal(out.track, "orchestrated");
    assert.equal(out.plan_source, "generate");
    assert.equal(out.plan_mode, "always");
  });
});
