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
import { loadConfig } from "../config.mjs";
import { validateArtifact } from "../lib/contract.mjs";
import { renderPrBody } from "../lib/pr-body.mjs";
import { detectGates } from "../lib/ship/gates.mjs";
import { gateFailureAction, scopeCheck } from "../lib/ship/inline.mjs";
import {
  filesOverlap,
  nextStep,
  resolveModels
} from "../lib/ship/milestones.mjs";
import {
  budgetCheck,
  milestoneBudget,
  phaseModel,
  resolvePhases
} from "../lib/ship/phases.mjs";
import { reviewLoop } from "../lib/ship/review-loop.mjs";
import { ShipError, shipSettings } from "../lib/ship/state.mjs";
import { prLoopAction, prOptions } from "../lib/ship/tail.mjs";
import { completedFromState } from "../plan.mjs";
import { validateFile } from "../runs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "ship.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const REFERENCE = join(HERE, "..", "..", "references", "plan-format.md");
const NOW = "2026-11-08T12:00:00.000Z";
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);
const PR = "https://github.com/o/r/pull/7";

let tmp;
let home;
let repo;
let runDir;

function cli(script, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ESP_SKILLS_HOME: home,
      ESP_RUNS_NOW: NOW,
      ...extraEnv
    }
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout)
  };
}

const ship = (...args) => cli(SCRIPT, [...args, "--run-dir", runDir]);
const state = () =>
  JSON.parse(readFileSync(join(runDir, "ship.json"), "utf8"));
const milestones = () =>
  JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
const runJson = () =>
  JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
const jsonl = (name) =>
  existsSync(join(runDir, name))
    ? readFileSync(join(runDir, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function git(...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function commit(file, text, message) {
  writeFileSync(join(repo, file), text);
  git("add", file);
  git(
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=T",
    "commit",
    "-qm",
    message
  );
  return git("rev-parse", "HEAD");
}

function userConfig(config) {
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ version: 1, ...config })
  );
}

function writeStep(name, block) {
  const r = cli(RUNS, [
    "result",
    name,
    "--run-dir",
    runDir,
    "--json",
    JSON.stringify(block)
  ]);
  assert.equal(r.code === 0 || r.code > 2, true, r.stderr);
}

const done = (outputs = {}, extra = {}) => ({
  status: "done",
  summary: "ok",
  outputs,
  ...extra
});

function init(...extra) {
  const r = ship(
    "init",
    "--request",
    "Add OAuth login",
    "--base",
    "main",
    "--project-dir",
    repo,
    ...extra
  );
  assert.equal(r.code, 0, r.stderr);
  return r.json();
}

const initInline = (...extra) => init("--track", "inline", ...extra);

function examplePlan() {
  const text = readFileSync(REFERENCE, "utf8");
  const example = text.slice(text.indexOf("## Example"));
  const m = /```markdown\r?\n([\s\S]*?)\r?\n```\s*$/.exec(example);
  assert.ok(m, "plan-format.md has an example plan");
  const path = join(runDir, "plan.md");
  writeFileSync(path, `${m[1]}\n`);
  return path;
}

function milestone(
  id,
  {
    depends = "none",
    files = `\`src/${id.toLowerCase()}.js\``,
    complexity = "low"
  } = {}
) {
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

function planText(version, items) {
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

${items.join("\n")}
## Risks

- None

## Open Questions

- None

## Out of Scope

- None
`;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-ship-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  commit("a.txt", "a\n", "init");
  git("switch", "-qc", "feature/oauth");
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

describe("cli", () => {
  test("--help lists every command", () => {
    const r = cli(SCRIPT, ["--help"]);
    assert.equal(r.code, 0);
    for (const command of [
      "init",
      "show",
      "next",
      "phase <name>",
      "review-loop",
      "pr-loop",
      "workspace",
      "worktree",
      "budget",
      "scope",
      "gate-failure",
      "switch-track",
      "escalate",
      "stop",
      "halt",
      "pr-body",
      "result",
      "milestone <cmd>",
      "    init",
      "    next",
      "    start <id>",
      "    finish <id>",
      "    models <id>",
      "    gates",
      "    show"
    ])
      assert.match(
        r.stdout,
        new RegExp(
          `\\n${command.startsWith(" ") ? "" : "  "}${command.replace(/[<>]/g, ".")}\\s`
        )
      );
    assert.equal(cli(SCRIPT, []).code, 2);
    assert.equal(ship("deploy").code, 2);
    assert.equal(ship("milestone", "deploy").code, 2);
  });
});

describe("resolvePhases", () => {
  test("orchestrated: canonical order, build required, plan always kept", () => {
    const { phases } = resolvePhases("orchestrated", [
      "merge",
      "build",
      "final-gates",
      "plan",
      "pr",
      "review",
      "branch",
      "fix-review"
    ]);
    assert.deepEqual(phases, [
      "plan",
      "branch",
      "build",
      "final-gates",
      "review",
      "pr",
      "fix-review",
      "merge"
    ]);
    assert.throws(() => resolvePhases("orchestrated", ["plan", "pr"]), ShipError);
    assert.equal(
      resolvePhases("orchestrated", ["build", "pr"]).phases[0],
      "plan"
    );
  });

  test("applies --no-pr, --no-merge, --stop-before-wait and internal_review_rounds 0", () => {
    const noPr = resolvePhases("orchestrated", undefined, { noPr: true });
    assert.deepEqual(noPr.phases, [
      "plan",
      "branch",
      "build",
      "final-gates",
      "review"
    ]);
    assert.equal(noPr.skipped.merge, "--no-pr");
    assert.equal(
      resolvePhases("orchestrated", undefined, { noMerge: true }).phases.at(
        -1
      ),
      "fix-review"
    );
    const noReview = resolvePhases("orchestrated", undefined, {
      reviewRounds: 0
    });
    assert.equal(noReview.phases.includes("review"), false);
    assert.match(noReview.skipped.review, /internal_review_rounds/);
    assert.equal(
      resolvePhases("orchestrated", ["plan", "build", "merge"]).skipped.merge,
      "needs the pr phase"
    );
    const stopped = resolvePhases("orchestrated", undefined, {
      stopBeforeWait: true
    });
    assert.equal(stopped.phases.at(-1), "pr");
    assert.match(stopped.skipped["fix-review"], /stop-before-wait/);
    assert.equal(stopped.skipped["await-review"], undefined);
  });

  test("inline: canonical order, implement required, wait phases need pr", () => {
    const { phases, skipped } = resolvePhases("inline", [
      "merge",
      "implement",
      "context",
      "pr",
      "branch",
      "fix-review"
    ]);
    assert.deepEqual(phases, [
      "context",
      "branch",
      "implement",
      "pr",
      "fix-review",
      "merge"
    ]);
    assert.deepEqual(skipped, {});
    const noPr = resolvePhases("inline", ["context", "implement", "merge"]);
    assert.deepEqual(noPr.phases, ["context", "implement"]);
    assert.equal(noPr.skipped.merge, "needs the pr phase");
    const stopped = resolvePhases("inline", undefined, {
      stopBeforeWait: true
    });
    assert.deepEqual(stopped.phases, ["context", "branch", "implement", "pr"]);
    assert.throws(() => resolvePhases("inline", ["context", "pr"]), ShipError);
    assert.throws(() => resolvePhases("sideways"), ShipError);
  });

  test("a shared phase list gives each track its own phases", () => {
    const all = [
      "plan",
      "context",
      "branch",
      "implement",
      "build",
      "review",
      "pr",
      "fix-review",
      "merge"
    ];
    assert.equal(resolvePhases("inline", all).phases.includes("build"), false);
    assert.equal(
      resolvePhases("orchestrated", all).phases.includes("implement"),
      false
    );
  });
});

describe("init", () => {
  test("orchestrated: creates ship.json and freezes the config", () => {
    const out = init();
    assert.equal(out.created, true);
    const s = state();
    assert.equal(s.workflow, "esp-ship");
    assert.equal(s.track, "orchestrated");
    assert.equal(s.run_owner, "self");
    assert.equal(s.request, "Add OAuth login");
    assert.equal(s.base_sha, git("rev-parse", "HEAD"));
    assert.equal(s.internal_review_rounds, 2);
    assert.deepEqual(s.pr_rounds, { max: 3, done: 0, commits: 0 });
    assert.equal(s.max_milestones, 12);
    assert.equal(s.max_wall_minutes, 240);
    assert.equal(s.interactive, "off");
    assert.equal(s.use_worktree, false);
    assert.equal(s.config_snapshot, join(runDir, "config.snapshot.json"));
    assert.equal(s.escalated_from, null);
    assert.deepEqual(Object.keys(s.phase_status), [
      "plan",
      "branch",
      "build",
      "final-gates",
      "review",
      "pr",
      "fix-review",
      "merge"
    ]);
  });

  test("inline: the inline limits and phases", () => {
    initInline();
    const s = state();
    assert.equal(s.track, "inline");
    assert.equal(s.max_files_changed, 10);
    assert.equal(s.escalate, true);
    assert.equal(s.max_wall_minutes, 60);
    assert.deepEqual(s.phases, [
      "context",
      "branch",
      "implement",
      "pr",
      "fix-review",
      "merge"
    ]);
    assert.ok(existsSync(join(runDir, "config.snapshot.json")));
  });

  test("reads the config and the flags", () => {
    userConfig({
      ship: {
        internal_review_rounds: 1,
        worktree: true,
        inline: { max_files_changed: 3, escalate: false },
        phases: ["context", "implement", "build", "review", "pr", "merge"]
      },
      "fix-review": { max_rounds: 5 }
    });
    init("--no-merge", "--interactive", "plan", "--max-rounds", "2");
    const s = state();
    assert.equal(s.internal_review_rounds, 1);
    assert.equal(s.use_worktree, true);
    assert.equal(s.pr_rounds.max, 2);
    assert.equal(s.interactive, "plan");
    assert.equal(s.phase_status.merge, "skipped");
    rmSync(join(runDir, "ship.json"));
    initInline("--stop-before-wait", "--caller-owned");
    const light = state();
    assert.equal(light.max_files_changed, 3);
    assert.equal(light.escalate, false);
    assert.equal(light.stop_before_wait, true);
    assert.equal(light.run_owner, "caller");
    assert.deepEqual(light.phases, ["context", "implement", "pr"]);
    assert.equal(light.phase_status.branch, "skipped");
    assert.equal(light.phase_status.merge, "skipped");
  });

  test("is idempotent and validates its options", () => {
    assert.equal(ship("init", "--project-dir", repo).code, 2);
    const bad = (...extra) =>
      ship("init", "--request", "x", "--project-dir", repo, ...extra).code;
    assert.equal(bad("--interactive", "sometimes"), 2);
    assert.equal(bad("--track", "sideways"), 2);
    assert.equal(bad("--base-sha", "nope"), 2);
    assert.equal(ship("init", "--resume").code, 2);
    init();
    const again = ship("init");
    assert.equal(again.code, 0);
    assert.equal(again.json().created, false);
    assert.equal(again.json().request, "Add OAuth login");
  });

  test("uses a given snapshot", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(
      snap,
      JSON.stringify({ version: 1, ship: { inline: { max_files_changed: 2 } } })
    );
    initInline("--config-snapshot", snap);
    assert.equal(state().config_snapshot, snap);
    assert.equal(state().max_files_changed, 2);
    assert.equal(existsSync(join(runDir, "config.snapshot.json")), false);
  });
});

describe("next and phase", () => {
  test("orchestrated: dispatches each phase with its role model", () => {
    init();
    let next = ship("next").json();
    assert.equal(next.track, "orchestrated");
    assert.equal(next.phase, "plan");
    assert.equal(next.skill, "esp-plan");
    assert.equal(next.role, "planner");
    assert.equal(next.model, "opus");
    assert.equal(next.effort, "high");
    assert.equal(next.cwd, repo);
    assert.equal(next.plan_source, "generate");
    assert.equal(ship("phase", "plan", "--status", "started").code, 0);
    assert.equal(ship("next").json().resumed, true);

    const planned = ship(
      "phase",
      "plan",
      "--status",
      "done",
      "--plan",
      examplePlan()
    ).json();
    assert.deepEqual(planned.milestones, {
      count: 2,
      max_milestones: 12,
      exceeded: false,
      action: "continue"
    });
    assert.equal(state().plan_title, "Add OAuth login");
    assert.deepEqual(state().milestones, ["M1", "M2"]);
    assert.ok(state().summary);

    next = ship("next").json();
    assert.equal(next.phase, "branch");
    assert.equal(next.model, "haiku");
    ship("phase", "branch", "--status", "done", "--branch", "feature/oauth");
    assert.equal(runJson().branch, "feature/oauth");
    next = ship("next").json();
    assert.equal(next.phase, "build");
    assert.equal(next.skill, null);
    assert.equal(next.model, null);
    assert.equal(next.milestone_loop, true);
    assert.equal(next.plan_path, join(runDir, "plan.md"));
    assert.equal(next.build_resume, false);
    writeFileSync(join(runDir, "state.json"), "{}");
    assert.equal(ship("next").json().build_resume, true);
  });

  test("orchestrated: the build always has a plan file", () => {
    init();
    assert.equal(ship("phase", "plan", "--status", "skipped").code, 2);
    assert.equal(ship("phase", "plan", "--status", "done").code, 2);
    assert.equal(ship("phase", "build", "--status", "started").code, 2);
    examplePlan();
    assert.equal(ship("next").json().plan_source, "reuse");
    const r = ship("phase", "plan", "--status", "done");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(state().plan_path, join(runDir, "plan.md"));
    assert.equal(ship("phase", "build", "--status", "started").code, 0);
  });

  test("orchestrated: dispatches the review loop and the pull request phases", () => {
    init();
    examplePlan();
    for (const p of ["plan", "branch", "build", "final-gates"])
      ship("phase", p, "--status", "done");
    let next = ship("next").json();
    assert.equal(next.phase, "review");
    assert.equal(next.sub, "review");
    assert.equal(next.loop.step, "review-1");
    writeStep(
      "review-1",
      done({
        findings: 2,
        by_severity: { critical: 0 },
        findings_path: "x.json"
      })
    );
    next = ship("next").json();
    assert.equal(next.sub, "review-fix");
    assert.equal(next.skill, "esp-fix-review");
    assert.equal(next.role, "fixer");
    assert.equal(next.loop.findings_path, "x.json");
    writeStep(
      "fix-review-1",
      done({ mode: "internal", fixed: 2, remaining: 0 })
    );
    assert.equal(ship("next").json().loop.step, "review-2");
    writeStep("review-2", done({ findings: 0 }));
    next = ship("next").json();
    assert.equal(next.action, "complete");
    ship("phase", "review", "--status", "done");
    next = ship("next").json();
    assert.equal(next.phase, "pr");
    assert.equal(next.draft, true);
    assert.equal(next.mark_ready, true);
    ship("phase", "pr", "--status", "done", "--pr", PR);
    assert.equal(runJson().pr, PR);
    next = ship("next").json();
    assert.equal(next.phase, "fix-review");
    assert.equal(next.rounds, 1);
    assert.equal(next.wait_step, "fix-review-wait");
    assert.equal(next.wait_checks, true);
    assert.equal(ship("phase", "await-review", "--status", "done").code, 2);
  });

  test("inline: runs every phase in the session and records the facts", () => {
    initInline();
    const first = ship("next").json();
    assert.equal(first.phase, "context");
    assert.equal(first.model, null);
    assert.equal(
      ship("phase", "context", "--status", "done", "--summary", "Adds hello()")
        .code,
      0
    );
    const sha = git("rev-parse", "HEAD");
    const branch = ship(
      "phase",
      "branch",
      "--status",
      "done",
      "--branch",
      "feature/oauth",
      "--base-sha",
      sha
    );
    assert.equal(branch.json().next, "implement");
    const c = commit("b.txt", "b\n", "Add greeting");
    ship(
      "phase",
      "implement",
      "--status",
      "done",
      "--commit",
      c,
      "--gates",
      '{"test":"pass","lint":"skipped"}'
    );
    const pr = ship("phase", "pr", "--status", "done", "--pr", PR);
    assert.equal(pr.json().next, "fix-review");
    assert.equal(ship("next").json().role, null);
    const s = state();
    assert.equal(s.summary, "Adds hello()");
    assert.equal(s.commit, c);
    assert.deepEqual(s.gates, { test: "pass", lint: "skipped" });
    const types = jsonl("events.jsonl").map((e) => e.type);
    assert.deepEqual(types.slice(1), [
      "branch.created",
      "commit.created",
      "pr.opened"
    ]);
    assert.equal(runJson().branch, "feature/oauth");
    assert.equal(runJson().pr, PR);
    assert.equal(cli(RUNS, ["validate", join(runDir, "events.jsonl")]).code, 0);
  });

  test("rejects unknown phases, statuses and values", () => {
    initInline();
    assert.equal(ship("phase", "deploy", "--status", "done").code, 2);
    assert.equal(ship("phase", "plan", "--status", "done").code, 2);
    assert.equal(ship("phase", "pr", "--status", "pending").code, 2);
    assert.equal(
      ship("phase", "pr", "--status", "done", "--commit", "nope").code,
      2
    );
    assert.equal(
      ship("phase", "implement", "--status", "done", "--plan", "x.md").code,
      2
    );
    assert.equal(
      ship("phase", "implement", "--status", "done", "--gates", "{").code,
      2
    );
  });

  test("halts on the wall time budget", () => {
    userConfig({ ship: { budgets: { orchestrated: { max_wall_minutes: 1 } } } });
    init();
    const later = cli(SCRIPT, ["next", "--run-dir", runDir], {
      ESP_RUNS_NOW: "2026-11-08T12:05:00.000Z"
    }).json();
    assert.equal(later.action, "halt");
    assert.equal(later.key, "budget");
    const budget = cli(SCRIPT, ["budget", "--run-dir", runDir], {
      ESP_RUNS_NOW: "2026-11-08T12:05:00.000Z"
    }).json();
    assert.equal(budget.exceeded, true);
  });
});

describe("loops", () => {
  const base = {
    internal_review_rounds: 2,
    halt_on: ["critical-security"],
    interactive: "off"
  };
  const step = (name, result) => ({ step: `01-${name}`, name, result });

  test("reviewLoop ends on a clean review, the last round, or a round that fixed nothing", () => {
    assert.equal(
      reviewLoop(null, { ...base, internal_review_rounds: 0 }, []).action,
      "done"
    );
    assert.equal(reviewLoop(null, base, []).step, "review-1");
    const found = step(
      "review-1",
      done({ findings: 1, by_severity: { critical: 0 } })
    );
    assert.equal(reviewLoop(null, base, [found]).action, "fix");
    assert.equal(
      reviewLoop(null, base, [step("review-1", done({ findings: 0 }))]).action,
      "done"
    );
    const nothing = reviewLoop(null, base, [
      found,
      step("fix-review-1", done({ fixed: 0, remaining: 1 }))
    ]);
    assert.equal(nothing.action, "done");
    assert.equal(nothing.remaining, 1);
    const found2 = step(
      "review-2",
      done({ findings: 1, by_severity: { critical: 0 } })
    );
    const last = reviewLoop(null, base, [
      found,
      step("fix-review-1", done({ fixed: 1 })),
      found2,
      step("fix-review-2", done({ fixed: 1, remaining: 0 }))
    ]);
    assert.equal(last.action, "done");
    assert.equal(last.exhausted, true);
  });

  test("reviewLoop halts on critical findings left, and stops on a failed step", () => {
    const critical = step(
      "review-1",
      done({ findings: 1, by_severity: { critical: 1 } })
    );
    const one = { ...base, internal_review_rounds: 1 };
    const halted = reviewLoop(null, one, [
      critical,
      step("fix-review-1", done({ fixed: 0, remaining: 1 }))
    ]);
    assert.equal(halted.action, "halt");
    assert.equal(halted.key, "critical-security");
    assert.equal(
      reviewLoop(null, { ...one, halt_on: [] }, [
        critical,
        step("fix-review-1", done({ fixed: 0, remaining: 1 }))
      ]).action,
      "done"
    );
    assert.equal(
      reviewLoop(null, base, [
        step("review-1", { status: "failed", summary: "x" })
      ]).action,
      "stop"
    );
  });

  test("prLoopAction rounds: wait, fix, wait again while commits are pushed", () => {
    const s = {
      pr_rounds: { max: 2, done: 0, commits: 0 },
      interactive: "off"
    };
    assert.equal(prLoopAction(s, "wait", done()).action, "fix");
    assert.equal(prLoopAction(s, "wait", null).action, "wait");
    const timedOut = prLoopAction(s, "wait", {
      status: "awaiting-human",
      summary: "t"
    });
    assert.equal(timedOut.action, "fix");
    assert.equal(timedOut.timed_out, true);
    assert.equal(
      prLoopAction({ ...s, interactive: "all" }, "wait", {
        status: "awaiting-human",
        summary: "t"
      }).action,
      "stop"
    );
    const pushed = prLoopAction(
      s,
      "fix",
      done({ rounds: 1, commits: ["a"], open: 0 })
    );
    assert.equal(pushed.action, "wait");
    assert.deepEqual(pushed.update, { done: 1, commits: 1 });
    const quiet = prLoopAction(
      { ...s, pr_rounds: { max: 2, done: 1, commits: 1 } },
      "fix",
      done({ rounds: 2, commits: ["a"], open: 0 })
    );
    assert.equal(quiet.action, "merge");
    const open = prLoopAction(
      s,
      "fix",
      done({ rounds: 1, commits: [], open: 2 })
    );
    assert.equal(open.action, "stop");
    assert.equal(open.status, "awaiting-human");
    assert.equal(
      prLoopAction(
        { ...s, pr_rounds: { max: 1, done: 0, commits: 0 } },
        "fix",
        done({ rounds: 1, commits: ["a"] })
      ).action,
      "merge"
    );
  });

  test("prLoopAction passes the failing checks of the wait to the fix round", () => {
    const s = {
      pr_rounds: { max: 2, done: 0, commits: 0 },
      interactive: "off"
    };
    const checks = { failing: ["ci"], pending: [], passing: ["lint"] };
    const fix = prLoopAction(s, "wait", done({ checks }));
    assert.equal(fix.action, "fix");
    assert.deepEqual(fix.failing_checks, ["ci"]);
    assert.equal(prLoopAction(s, "wait", done()).failing_checks, undefined);
    const timedOut = prLoopAction(s, "wait", {
      status: "awaiting-human",
      summary: "t",
      outputs: { checks }
    });
    assert.equal(timedOut.action, "fix");
    assert.equal(timedOut.timed_out, true);
    assert.deepEqual(timedOut.failing_checks, ["ci"]);
  });

  test("pr-loop --after wait: a closed pull request stops, a headless timeout fixes", () => {
    init();
    writeStep("fix-review-wait", {
      status: "failed",
      summary: "Pull request #7 is closed"
    });
    let out = ship("pr-loop", "--after", "wait").json();
    assert.equal(out.action, "stop");
    assert.equal(out.status, "failed");
    assert.equal(state().stop.status, "failed");
    rmSync(join(runDir, "ship.json"), { force: true });
    rmSync(join(runDir, "steps"), { recursive: true, force: true });
    init();
    writeStep("fix-review-wait", {
      status: "awaiting-human",
      summary: "Timed out",
      outputs: { checks: { failing: [], pending: ["ci"], passing: [] } }
    });
    out = ship("pr-loop", "--after", "wait").json();
    assert.equal(out.action, "fix");
    assert.equal(out.timed_out, true);
    assert.equal(state().stop ?? null, null);
    assert.equal(ship("pr-loop", "--after", "await").code, 2);
  });

  test("pr-loop records the rounds and the stop, on both tracks", () => {
    for (const track of ["orchestrated", "inline"]) {
      rmSync(join(runDir, "ship.json"), { force: true });
      rmSync(join(runDir, "steps"), { recursive: true, force: true });
      init("--track", track);
      writeStep(
        "fix-review",
        done({ mode: "pr", rounds: 1, commits: ["a"], open: 1 })
      );
      const out = ship("pr-loop", "--after", "fix").json();
      assert.equal(out.action, "stop");
      assert.equal(state().pr_rounds.done, 1);
      assert.equal(state().stop.status, "awaiting-human");
      assert.equal(ship("next").json().action, "result");
    }
    assert.equal(ship("pr-loop", "--after", "merge").code, 2);
  });
});

describe("helpers", () => {
  test("phaseModel, prOptions, milestoneBudget and budgetCheck", () => {
    const config = {
      defaults: {
        models: {
          planner: { model: "opus", effort: "high" },
          mechanical: { model: "haiku" }
        }
      }
    };
    assert.deepEqual(phaseModel(config, "plan"), {
      role: "planner",
      model: "opus",
      effort: "high"
    });
    assert.deepEqual(phaseModel(config, "merge"), {
      role: "fixer",
      model: "inherit"
    });
    assert.deepEqual(phaseModel(config, "final-gates"), {
      role: null,
      model: null
    });
    assert.deepEqual(phaseModel(config, "branch", "inline"), {
      role: null,
      model: null
    });
    assert.deepEqual(
      prOptions({ pr_draft_until_reviewed: false }, { pr: { draft: true } }),
      { draft: true, mark_ready: false }
    );
    assert.deepEqual(prOptions({ pr_draft_until_reviewed: false }, {}), {
      draft: false,
      mark_ready: false
    });
    const big = {
      milestones: ["M1", "M2", "M3"],
      max_milestones: 2,
      halt_on: ["budget"]
    };
    assert.equal(milestoneBudget(big).action, "halt");
    assert.equal(
      milestoneBudget({ ...big, halt_on: [] }).action,
      "continue-over-budget"
    );
    const s = {
      created_at: "2026-11-08T10:00:00.000Z",
      max_wall_minutes: 60,
      halt_on: ["budget"]
    };
    const at = new Date("2026-11-08T11:30:00.000Z");
    assert.deepEqual(budgetCheck(s, at), {
      elapsed_minutes: 90,
      max_wall_minutes: 60,
      exceeded: true,
      action: "halt"
    });
    assert.equal(
      budgetCheck({ ...s, halt_on: [] }, at).action,
      "continue-over-budget"
    );
    assert.equal(
      budgetCheck(s, new Date("2026-11-08T10:30:00.000Z")).action,
      "continue"
    );
    assert.equal(
      budgetCheck({ ...s, max_wall_minutes: null }, at).exceeded,
      false
    );
  });

  test("shipSettings reads ship.*, then defaults", () => {
    assert.equal(shipSettings({}, "inline").max_wall_minutes, 60);
    assert.equal(shipSettings({}).max_wall_minutes, 240);
    assert.equal(shipSettings({}).parallel, false);
    const config = {
      ship: {
        internal_review_rounds: 3,
        inline: { max_files_changed: 6, escalate: false },
        budgets: { inline: { max_wall_minutes: 30 } },
        max_retries_per_milestone: 1,
        parallel: "on",
        gates: { lint: "x" },
        phases: ["plan", "build", "pr", "fix-review"]
      }
    };
    const settings = shipSettings(config);
    assert.equal(settings.internal_review_rounds, 3);
    assert.equal(settings.max_files_changed, 6);
    assert.equal(settings.escalate, false);
    assert.equal(shipSettings(config, "inline").max_wall_minutes, 30);
    assert.equal(settings.max_wall_minutes, 240);
    assert.equal(settings.max_retries_per_milestone, 1);
    assert.equal(settings.parallel, true);
    assert.deepEqual(settings.gates, { lint: "x" });
    assert.deepEqual(settings.phases, ["plan", "build", "pr", "fix-review"]);
    assert.equal(shipSettings({ ship: { parallel: "auto" } }).parallel, false);
    assert.equal(shipSettings({ ship: { parallel: "off" } }).parallel, false);
  });
});

describe("inline limits", () => {
  test("scope counts tracked and untracked changes", () => {
    userConfig({ ship: { inline: { max_files_changed: 2 } } });
    initInline();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "b.txt"), "new\n");
    const ok = ship("scope").json();
    assert.deepEqual(ok.files, ["a.txt", "b.txt"]);
    assert.equal(ok.exceeded, false);
    assert.equal(ok.action, "continue");
    writeFileSync(join(repo, "c.txt"), "new\n");
    const over = ship("scope").json();
    assert.equal(over.count, 3);
    assert.equal(over.action, "escalate");
    assert.equal(over.escalate_with, "switch-track");
    assert.equal(ship("scope", "--estimate", "5").json().action, "escalate");
    assert.equal(ship("scope", "--estimate", "1").json().action, "continue");
    assert.equal(ship("scope", "--estimate", "-1").code, 2);
  });

  test("scopeCheck continues over the limit when escalation is off", () => {
    const s = { max_files_changed: 1, escalate: false };
    assert.equal(scopeCheck(s, ["a", "b"]).action, "continue-over-limit");
    assert.equal(
      scopeCheck({ ...s, escalate: true, run_owner: "caller" }, ["a", "b"])
        .escalate_with,
      "escalate"
    );
  });

  test("the second gate failure escalates, or halts without escalation", () => {
    initInline();
    assert.equal(
      ship("gate-failure", "--reason", "test failed").json().action,
      "retry"
    );
    const second = ship("gate-failure", "--reason", "test failed").json();
    assert.equal(second.gate_failures, 2);
    assert.equal(second.action, "escalate");
    assert.equal(second.escalate_with, "switch-track");
    assert.deepEqual(state().gate_failure_reasons, [
      "test failed",
      "test failed"
    ]);
    assert.equal(
      gateFailureAction({
        gate_failures: 2,
        gate_failure_limit: 2,
        escalate: false
      }),
      "halt"
    );
  });
});

describe("switch-track", () => {
  test("moves an owned inline run to the orchestrated track in place", () => {
    initInline();
    ship("phase", "context", "--status", "done");
    ship("phase", "branch", "--status", "done", "--branch", "feature/oauth");
    ship("phase", "implement", "--status", "started");
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    const r = ship(
      "switch-track",
      "--to",
      "orchestrated",
      "--trigger",
      "files",
      "--reason",
      "touches 14 files"
    );
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.equal(out.track, "orchestrated");
    assert.equal(out.next, "plan");
    assert.deepEqual(out.files, ["a.txt", "new.txt"]);
    const s = state();
    assert.equal(s.track, "orchestrated");
    assert.equal(s.branch, "feature/oauth");
    assert.equal(s.phase_status.branch, "done");
    assert.equal(s.phase_status.plan, "pending");
    assert.equal(s.phase_status.implement, undefined);
    assert.equal(s.max_wall_minutes, 240);
    assert.equal(s.escalated_from.in_place, true);
    assert.equal(s.escalated_from.stash, null);
    assert.equal(s.track_history[0].phase_status.implement, "started");
    // The uncommitted work stays in the tree, with no stash.
    assert.match(git("status", "--porcelain"), /new\.txt/);
    assert.equal(git("stash", "list"), "");
    const [decision] = jsonl("decisions.jsonl");
    assert.equal(decision["x-esp-escalation"], "files");
    assert.equal(decision.phase, "implement");
    assert.equal(decision.source, "policy");
    assert.equal(s.escalated_from.decision, decision.id);
    const next = ship("next").json();
    assert.equal(next.phase, "plan");
    assert.equal(next.role, "planner");
    const block = ship("result").json();
    assert.equal(block.outputs.track, "orchestrated");
    assert.equal(block.outputs.escalated_from.trigger, "files");
    assert.equal(block.outputs.track_history.length, 1);
    // Only inline -> orchestrated, once.
    assert.equal(
      ship("switch-track", "--trigger", "files", "--reason", "again").code,
      1
    );
  });

  test("refuses a caller-owned run and validates its arguments", () => {
    initInline("--caller-owned");
    assert.equal(
      ship("switch-track", "--trigger", "design", "--reason", "x").code,
      1
    );
    rmSync(join(runDir, "ship.json"));
    initInline();
    assert.equal(
      ship("switch-track", "--trigger", "mood", "--reason", "x").code,
      2
    );
    assert.equal(ship("switch-track", "--trigger", "files").code, 2);
    assert.equal(
      ship("switch-track", "--to", "inline", "--trigger", "files", "--reason", "x")
        .code,
      2
    );
    // An owned run switches in place instead of escalating.
    assert.equal(ship("escalate", "--trigger", "files", "--reason", "x").code, 1);
    const design = ship(
      "switch-track",
      "--trigger",
      "design",
      "--reason",
      "two storage designs"
    );
    assert.equal(design.code, 0, design.stderr);
    assert.equal(jsonl("decisions.jsonl")[0].source, "agent");
    assert.equal(jsonl("decisions.jsonl")[0].phase, "context");
  });
});

describe("escalate (caller-owned run)", () => {
  test("saves a patch, stashes the work, logs the decision and exits 30", () => {
    initInline("--caller-owned");
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    const r = ship(
      "escalate",
      "--trigger",
      "files",
      "--reason",
      "touches 14 files"
    );
    assert.equal(r.code, 30, r.stderr);
    const block = r.json();
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "escalate");
    assert.deepEqual(block.files_changed, ["a.txt", "new.txt"]);
    const e = block.outputs.escalation;
    assert.equal(e.trigger, "files");
    assert.equal(e.stash, `esp-ship escalation ${runJson().id}`);
    assert.deepEqual(block.outputs.next, {
      skill: "esp-ship",
      run_dir: runDir,
      track: "orchestrated",
      resume: true
    });
    assert.equal(git("status", "--porcelain"), "");
    assert.match(git("stash", "list"), /esp-ship escalation/);
    // The patch restores the work on a clean tree.
    git("apply", "--check", e.patch);
    git("apply", e.patch);
    assert.equal(readFileSync(join(repo, "new.txt"), "utf8"), "new\n");
    const [decision] = jsonl("decisions.jsonl");
    assert.equal(decision["x-esp-escalation"], "files");
    assert.equal(decision.source, "policy");
    assert.equal(decision.risk, "medium");
    assert.equal(state().escalation.decision, decision.id);
    assert.equal(state().phase_status.implement, "skipped");
    assert.equal(ship("next").json().action, "result");
    const result = ship("result");
    assert.equal(result.code, 30);
    assert.equal(result.json().status, "escalate");
    assert.equal(
      ship("escalate", "--trigger", "gates", "--reason", "again").code,
      1
    );
  });

  test("keeps the tree with --keep-tree, and a design escalation is an agent decision", () => {
    initInline("--caller-owned");
    writeFileSync(join(repo, "a.txt"), "changed\n");
    const r = ship(
      "escalate",
      "--trigger",
      "design",
      "--reason",
      "two storage designs",
      "--question",
      "SQL or KV?",
      "--keep-tree"
    );
    assert.equal(r.code, 30);
    assert.equal(r.json().outputs.escalation.stash, null);
    assert.equal(r.json().outputs.escalation.question, "SQL or KV?");
    assert.notEqual(git("status", "--porcelain"), "");
    assert.equal(jsonl("decisions.jsonl")[0].source, "agent");
  });

  test("validates its arguments", () => {
    initInline("--caller-owned");
    assert.equal(ship("escalate", "--trigger", "mood", "--reason", "x").code, 2);
    assert.equal(ship("escalate", "--trigger", "files").code, 2);
    rmSync(join(runDir, "ship.json"));
    init("--caller-owned");
    assert.equal(ship("escalate", "--trigger", "files", "--reason", "x").code, 1);
  });

  test("a resume takes the escalated run over on the orchestrated track", () => {
    initInline("--caller-owned");
    ship("phase", "branch", "--status", "done", "--branch", "feature/oauth");
    writeFileSync(join(repo, "b.txt"), "work in progress\n");
    const escalated = ship(
      "escalate",
      "--trigger",
      "files",
      "--reason",
      "12 files estimated"
    );
    assert.equal(escalated.code, 30, escalated.stderr);
    writeStep("ship", JSON.parse(escalated.stdout));
    cli(RUNS, ["update", "--run-dir", runDir, "--status", "halted"]);

    const out = ship("init", "--resume");
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.json().taken_over, true);
    const s = state();
    assert.equal(s.track, "orchestrated");
    assert.equal(s.escalation, null);
    assert.equal(s.branch, "feature/oauth");
    assert.equal(s.phase_status.branch, "done");
    assert.equal(s.phase_status.plan, "pending");
    assert.equal(s.escalated_from.trigger, "files");
    assert.equal(s.escalated_from.in_place, false);
    assert.equal(s.escalated_from.patch, join(runDir, "escalation.patch"));
    assert.match(s.escalated_from.stash, /esp-ship escalation/);
    assert.equal(runJson().status, "running");
    assert.ok(
      jsonl("events.jsonl").some(
        (e) => e.type === "run.resumed" && e.data.from === "inline"
      )
    );
    assert.equal(ship("next").json().phase, "plan");
    // The escalate step of the inline run does not decide the final status.
    ship("stop", "--status", "failed", "--reason", "gave up");
    assert.equal(ship("result").json().status, "failed");
  });
});

describe("worktree", () => {
  test("creates the task worktree under worktrees.root and records it", () => {
    userConfig({ worktrees: { root: join(tmp, "worktrees") } });
    init("--base-sha", git("rev-parse", "HEAD"));
    assert.equal(ship("worktree").code, 2);
    const out = ship(
      "worktree",
      "--branch",
      "feature/oauth-wt",
      "--from",
      "main"
    );
    assert.equal(out.code, 0, out.stderr);
    const { path, created } = out.json();
    assert.equal(created, true);
    assert.ok(existsSync(join(path, "a.txt")));
    assert.equal(state().worktree, path);
    assert.equal(state().project_dir, path);
    assert.equal(ship("next").json().cwd, path);
    assert.equal(
      ship("worktree", "--branch", "feature/oauth-wt").json().created,
      false
    );
    git("worktree", "remove", "--force", path);
  });
});

describe("stop, halt and resume", () => {
  test("halt logs a Halt decision and skips the remaining phases", () => {
    init();
    const out = ship(
      "halt",
      "--key",
      "scope-change",
      "--reason",
      "the plan changes the public API"
    );
    assert.equal(out.code, 20, out.stderr);
    const block = JSON.parse(out.stdout);
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "halted");
    assert.deepEqual(block.blockers, [
      "scope-change: the plan changes the public API"
    ]);
    const [decision] = jsonl("decisions.jsonl");
    assert.equal(decision["x-esp-class"], "Halt");
    assert.equal(decision.risk, "high");
    assert.match(decision.rationale, /^Halt: scope-change/);
    assert.equal(state().phase_status.merge, "skipped");
    assert.equal(ship("next").json().action, "result");
    const result = ship("result");
    assert.equal(result.code, 20);
    assert.equal(JSON.parse(result.stdout).status, "halted");
    assert.equal(ship("halt", "--key", "boredom", "--reason", "x").code, 2);
    assert.equal(ship("halt", "--key", "budget").code, 2);
  });

  test("a recorded stop sets the status and the blockers", () => {
    init();
    writeStep("build", done());
    assert.equal(ship("stop", "--status", "paused", "--reason", "x").code, 2);
    ship("stop", "--status", "awaiting-human", "--reason", "2 review items open");
    const out = ship("result");
    assert.equal(out.code, 10);
    const block = JSON.parse(out.stdout);
    assert.equal(block.status, "awaiting-human");
    assert.deepEqual(block.blockers, ["2 review items open"]);
  });

  test("a resume lifts an awaiting-human stop and restores the unfinished phases", () => {
    init();
    ship("phase", "plan", "--status", "done", "--plan", examplePlan());
    ship("phase", "branch", "--status", "started");
    ship("stop", "--status", "awaiting-human", "--reason", "open question");
    assert.equal(JSON.parse(ship("next").stdout).action, "result");
    assert.equal(
      JSON.parse(ship("init").stdout).stop.status,
      "awaiting-human"
    );
    const resumed = JSON.parse(ship("init", "--resume").stdout);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.stop, null);
    assert.equal(resumed.phase_status.plan, "done");
    assert.equal(resumed.phase_status.branch, "started");
    const next = JSON.parse(ship("next").stdout);
    assert.equal(next.action, "run");
    assert.equal(next.phase, "branch");
    assert.equal(next.resumed, true);
    assert.ok(jsonl("events.jsonl").some((e) => e.type === "run.resumed"));
  });

  test("a resume leaves a failed stop and a halt in place", () => {
    init();
    ship("stop", "--status", "failed", "--reason", "broken");
    const out = JSON.parse(ship("init", "--resume").stdout);
    assert.equal(out.resumed, false);
    assert.equal(out.stop.status, "failed");
    rmSync(join(runDir, "ship.json"));
    initInline();
    ship("halt", "--key", "budget", "--reason", "60 minutes exceeded");
    assert.equal(JSON.parse(ship("init", "--resume").stdout).resumed, false);
  });
});

describe("result", () => {
  test("orchestrated: follows the last step that ran, and merged wins", () => {
    init();
    commit("m1.txt", "1\n", "feat: M1 add the provider");
    commit("m2.txt", "2\n", "feat: M2 add the route");
    writeFileSync(
      join(runDir, "state.json"),
      JSON.stringify({
        order: ["M1", "M2"],
        milestones: {
          M1: { title: "Add the provider", status: "done", commit: "1111111" },
          M2: { title: "Add the route", status: "done", commit: "2222222" }
        }
      })
    );
    writeStep(
      "build",
      done({ milestones_done: ["M1", "M2"], milestones_remaining: [] })
    );
    writeStep("review-1", done({ findings: 0 }));
    writeStep("fix-review-wait", {
      status: "awaiting-human",
      summary: "timed out",
      outputs: {
        reviewers: { codex: "pending" },
        completed: [],
        pending: ["codex"],
        checks: { failing: ["ci"], pending: [], passing: [] }
      }
    });
    writeStep(
      "fix-review",
      done({ mode: "pr", rounds: 1, fixed: 1, commits: ["c"] })
    );
    let block = ship("result").json();
    assert.equal(block.status, "done");
    assert.deepEqual(block.outputs.milestone_commits, {
      M1: "1111111",
      M2: "2222222"
    });
    assert.equal(block.outputs.commits.length, 2);
    assert.equal(block.outputs.internal_review.rounds, 1);
    assert.deepEqual(block.outputs.fix_review_wait.checks.failing, ["ci"]);
    assert.equal(block.outputs.await_review, undefined);
    writeStep("merge", {
      status: "merged",
      summary: "merged",
      outputs: { outcome: "merged", merged: true, method: "squash" }
    });
    const merged = ship("result");
    assert.equal(merged.code, 0);
    block = JSON.parse(merged.stdout);
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.merge.method, "squash");
  });

  test("inline: done after --stop-before-wait, with commits and gates", () => {
    initInline("--stop-before-wait");
    const c = commit("b.txt", "b\n", "Add greeting");
    ship(
      "phase",
      "implement",
      "--status",
      "done",
      "--commit",
      c,
      "--gates",
      '{"test":"pass"}'
    );
    ship("phase", "pr", "--status", "done", "--pr", PR);
    const r = ship("result");
    assert.equal(r.code, 0, r.stderr);
    const block = r.json();
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "done");
    assert.equal(block.commit, c);
    assert.equal(block.pr, PR);
    assert.deepEqual(block.files_changed, ["b.txt"]);
    assert.deepEqual(block.gates, { test: "pass" });
    assert.equal(block.outputs.track, "inline");
    assert.deepEqual(block.outputs.deferred_phases, [
      "fix-review",
      "merge"
    ]);
    assert.match(block.summary, /left to the caller/);
    const recorded = cli(RUNS, [
      "result",
      "ship",
      "--run-dir",
      runDir,
      "--json",
      r.stdout
    ]);
    assert.equal(recorded.code, 0, recorded.stderr);
  });

  test("inline: merged from the merge step, with review fixes and follow-ups", () => {
    initInline();
    commit("b.txt", "b\n", "Add greeting");
    commit("b.txt", "b2\n", "fix(review): handle empty names");
    writeStep("fix-review", {
      status: "done",
      summary: "Fixed 1.",
      outputs: {
        mode: "pr",
        pr: 7,
        rounds: 1,
        fixed: 1,
        rejected: 1,
        deferred: 1,
        open: 0
      },
      discovered_items: [{ type: "follow-up", title: "Localize the greeting" }]
    });
    writeStep("merge", {
      status: "merged",
      summary: "Merged.",
      outputs: { outcome: "merged", merged: true, method: "squash" }
    });
    const block = ship("result").json();
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.review_fix_commits, 1);
    assert.equal(block.outputs.commits.length, 2);
    assert.equal(block.outputs.fix_review.fixed, 1);
    assert.equal(block.outputs.merge.method, "squash");
    assert.deepEqual(block.discovered_items, [
      { type: "follow-up", title: "Localize the greeting" }
    ]);
    assert.match(block.summary, /squash/);
  });

  test("passes an awaiting-human step through with its needs_input", () => {
    initInline();
    const needs = {
      id: "fix-review-wait-timeout",
      question: "Keep waiting?",
      options: [{ id: "wait", label: "Wait" }],
      recommended: "wait",
      blocking: true
    };
    writeStep("fix-review-wait", {
      status: "awaiting-human",
      summary: "Timed out.",
      needs_input: needs
    });
    const r = ship("result");
    assert.equal(r.code, 10);
    assert.deepEqual(r.json().needs_input, needs);
    assert.equal(
      ship("result", "--status", "failed", "--summary", "Gave up.").json()
        .summary,
      "Gave up."
    );
    assert.equal(ship("result", "--status", "nope").code, 2);
  });
});

describe("pr-body", () => {
  const artifacts = {
    decisions: [
      {
        id: "D001",
        phase: "implement",
        risk: "low",
        decision: "Used the existing logger",
        "x-esp-class": "A-Fix"
      },
      {
        id: "D002",
        phase: "implement",
        risk: "medium",
        decision: "Default name is World",
        "x-esp-class": "B-Decide"
      },
      {
        id: "D003",
        phase: "fix-review",
        risk: "low",
        decision: "Kept the helper inline",
        "x-esp-class": "Reject"
      },
      {
        id: "D004",
        phase: "merge",
        risk: "low",
        decision: "Merged with squash"
      }
    ],
    steps: [
      {
        name: "fix-review",
        result: {
          outputs: {
            mode: "pr",
            pr: 7,
            rounds: 2,
            fixed: 3,
            rejected: 1,
            deferred: 0
          },
          discovered_items: [{ type: "docs", title: "Document hello()" }]
        }
      }
    ],
    build: null
  };

  test("renders the sections from the run artifacts", () => {
    const body = renderPrBody(artifacts, { summary: "Adds hello()." });
    assert.match(body, /^## Summary\n\nAdds hello\(\)\./);
    assert.ok(body.indexOf("D002") < body.indexOf("D001"), "medium risk first");
    assert.doesNotMatch(body, /D004/);
    assert.match(
      body,
      /## Review Resolution\n\n- PR review #7: 3 fixed, 1 rejected, 2 rounds\n {2}- Rejected \(D003\): Kept the helper inline/
    );
    assert.match(body, /## Follow-ups\n\n- docs: Document hello\(\)/);
    assert.doesNotMatch(body, /## Milestones/);
    assert.match(body, /Generated with \[Claude Code\]/);
  });

  test("honors the section list and drops the attribution", () => {
    const body = renderPrBody(artifacts, {
      summary: "S",
      sections: ["summary", "follow-ups"],
      attribution: null
    });
    assert.equal(
      body,
      "## Summary\n\nS\n\n## Follow-ups\n\n- docs: Document hello()\n"
    );
  });

  test("orchestrated: builds the body from the plan, the build state and the decisions", () => {
    init();
    ship("phase", "plan", "--status", "done", "--plan", examplePlan());
    writeFileSync(
      join(runDir, "state.json"),
      JSON.stringify({
        order: ["M1", "M2"],
        milestones: {
          M1: {
            title: "Add the provider",
            status: "done",
            commit: "1111111abc"
          },
          M2: { title: "Add the route", status: "done", commit: "2222222abc" }
        }
      })
    );
    cli(RUNS, [
      "decision",
      "--run-dir",
      runDir,
      "--json",
      JSON.stringify({
        phase: "build",
        source: "agent",
        risk: "high",
        decision: "Store tokens encrypted",
        rationale: "B-Decide"
      })
    ]);
    const body = ship("pr-body").stdout;
    assert.match(body, /^## Summary\n\n/);
    assert.match(
      body,
      /## Milestones\n\n- M1: Add the provider \(1111111\)\n- M2: Add the route \(2222222\)/
    );
    assert.match(body, /D001 \(high\): Store tokens encrypted/);
    const out = ship(
      "pr-body",
      "--summary",
      "Adds OAuth.",
      "--out",
      join(runDir, "pr-body.md")
    ).json();
    assert.ok(out.bytes > 0);
    assert.match(
      readFileSync(join(runDir, "pr-body.md"), "utf8"),
      /^## Summary\n\nAdds OAuth\./
    );
  });

  test("inline: reads the run and the frozen config", () => {
    userConfig({ pr: { attribution: false } });
    initInline();
    ship("phase", "context", "--status", "done", "--summary", "Adds hello().");
    cli(RUNS, [
      "decision",
      "--run-dir",
      runDir,
      "--json",
      JSON.stringify({
        phase: "implement",
        source: "agent",
        risk: "medium",
        decision: "Default name is World",
        rationale: "B-Decide: smallest change",
        "x-esp-class": "B-Decide"
      })
    ]);
    const r = ship("pr-body");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /## Summary\n\nAdds hello\(\)\./);
    assert.match(r.stdout, /D001 \(B-Decide, medium\): Default name is World/);
    assert.doesNotMatch(r.stdout, /Generated with/);
    const out = join(tmp, "body.md");
    assert.equal(ship("pr-body", "--out", out).code, 0);
    assert.equal(readFileSync(out, "utf8"), r.stdout);
  });
});

describe("milestone init", () => {
  beforeEach(() => {
    writeFileSync(
      join(runDir, "plan.md"),
      planText(1, [
        milestone("M1"),
        milestone("M2", { depends: "M1" }),
        milestone("M3", { complexity: "high" })
      ])
    );
  });

  test("creates state.json from the latest plan and freezes the config", () => {
    const r = ship("milestone", "init", "--base", SHA1, "--project-dir", repo);
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.equal(out.created, true);
    assert.deepEqual(out.added, ["M1", "M2", "M3"]);
    const s = milestones();
    assert.equal(s.state_format, 1);
    assert.equal(s.workflow, "esp-ship");
    assert.equal(s.plan_version, 1);
    assert.equal(s.base, SHA1);
    assert.equal(s.max_retries, 2);
    assert.deepEqual(s.order, ["M1", "M2", "M3"]);
    assert.deepEqual(s.milestones.M2.depends, ["M1"]);
    assert.equal(s.milestones.M3.complexity, "high");
    assert.equal(s.milestones.M1.status, "pending");
    assert.ok(existsSync(s.config_snapshot));
    assert.equal(
      loadConfig({ snapshot: s.config_snapshot }).config.ship
        .max_retries_per_milestone,
      2
    );
  });

  test("shares the config snapshot of ship.json", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(
      snap,
      JSON.stringify({
        version: 1,
        ship: { max_retries_per_milestone: 0, parallel: "on" }
      })
    );
    init("--config-snapshot", snap);
    assert.equal(ship("milestone", "init").code, 0);
    const s = milestones();
    assert.equal(s.config_snapshot, snap);
    assert.equal(s.max_retries, 0);
    assert.equal(s.parallel, true);
    assert.equal(existsSync(join(runDir, "config.snapshot.json")), false);
  });

  test("uses a given config snapshot instead of writing one", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(
      snap,
      JSON.stringify({ version: 1, ship: { max_retries_per_milestone: 1 } })
    );
    assert.equal(ship("milestone", "init", "--config-snapshot", snap).code, 0);
    assert.equal(milestones().config_snapshot, snap);
    assert.equal(milestones().max_retries, 1);
  });

  test("is idempotent and keeps progress", () => {
    ship("milestone", "init");
    ship("milestone", "start", "M1", "--base", SHA1);
    ship("milestone", "finish", "M1", "--status", "done", "--commit", SHA2);
    const r = ship("milestone", "init");
    assert.equal(r.json().created, false);
    assert.equal(milestones().milestones.M1.status, "done");
  });

  test("syncs with an amended plan: keeps done, adds new, drops removed", () => {
    ship("milestone", "init");
    ship("milestone", "start", "M1");
    ship("milestone", "finish", "M1", "--status", "done", "--commit", SHA2);
    writeFileSync(
      join(runDir, "plan.v2.md"),
      planText(2, [
        milestone("M1"),
        milestone("M2", { depends: "M1" }),
        milestone("M4")
      ])
    );
    const r = ship("milestone", "init");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json().added, ["M4"]);
    assert.deepEqual(r.json().removed, ["M3"]);
    const s = milestones();
    assert.equal(s.plan_version, 2);
    assert.deepEqual(s.order, ["M1", "M2", "M4"]);
    assert.equal(s.milestones.M1.commit, SHA2);
  });

  test("fails when a done milestone disappears from the plan", () => {
    ship("milestone", "init");
    ship("milestone", "start", "M1");
    ship("milestone", "finish", "M1", "--status", "done", "--commit", SHA2);
    writeFileSync(join(runDir, "plan.v2.md"), planText(2, [milestone("M2")]));
    const r = ship("milestone", "init");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Completed milestone M1 is missing/);
  });

  test("fails on a plan that does not lint, and without a plan", () => {
    writeFileSync(join(runDir, "plan.md"), "# not a plan\n");
    assert.equal(ship("milestone", "init").code, 1);
    rmSync(join(runDir, "plan.md"));
    const r = ship("milestone", "init");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No plan/);
  });

  test("reads the plan recorded in ship.json when the run dir has none", () => {
    const outside = join(tmp, "imported.md");
    writeFileSync(outside, readFileSync(join(runDir, "plan.md"), "utf8"));
    rmSync(join(runDir, "plan.md"));
    init();
    ship("phase", "plan", "--status", "done", "--plan", outside);
    const r = ship("milestone", "init");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(milestones().plan_path, outside);
  });

  test("requires a run dir", () => {
    assert.equal(cli(SCRIPT, ["milestone", "init"]).code, 2);
  });
});

describe("milestone loop", () => {
  beforeEach(() => {
    writeFileSync(
      join(runDir, "plan.md"),
      planText(1, [
        milestone("M1"),
        milestone("M2", { depends: "M1" }),
        milestone("M3", { complexity: "high" })
      ])
    );
    assert.equal(ship("milestone", "init", "--base", SHA1).code, 0);
  });

  test("three milestones run in order and end with action done", () => {
    const commits = { M1: SHA1, M2: SHA2, M3: SHA3 };
    const seen = [];
    for (;;) {
      const next = ship("milestone", "next").json();
      if (next.action === "done") break;
      assert.equal(next.action, "run");
      seen.push(next.milestone);
      assert.equal(ship("milestone", "start", next.milestone).json().attempt, 1);
      assert.equal(
        ship(
          "milestone",
          "finish",
          next.milestone,
          "--status",
          "done",
          "--commit",
          commits[next.milestone]
        ).code,
        0
      );
    }
    assert.deepEqual(seen, ["M1", "M2", "M3"]);
    assert.deepEqual(completedFromState(runDir).sort(), ["M1", "M2", "M3"]);
    assert.deepEqual(
      jsonl("events.jsonl")
        .filter((e) => e.type === "commit.created")
        .map((e) => e.data.milestone),
      ["M1", "M2", "M3"]
    );
    assert.equal(validateFile(join(runDir, "events.jsonl")).valid, true);
    assert.equal(ship("milestone", "show").json().milestones.M3.status, "done");
  });

  test("a failed attempt is retried with the commit to amend, then halts when exhausted", () => {
    ship("milestone", "start", "M1");
    ship(
      "milestone",
      "finish",
      "M1",
      "--status",
      "failed",
      "--commit",
      SHA2,
      "--reason",
      "lint fails"
    );
    let next = ship("milestone", "next").json();
    assert.equal(next.action, "retry");
    assert.equal(next.attempt, 2);
    assert.equal(next.amend, SHA2);
    assert.equal(next.last_failure, "lint fails");
    ship("milestone", "start", "M1");
    ship(
      "milestone",
      "finish",
      "M1",
      "--status",
      "failed",
      "--reason",
      "lint still fails"
    );
    ship("milestone", "start", "M1");
    ship("milestone", "finish", "M1", "--status", "failed");
    next = ship("milestone", "next").json();
    assert.equal(next.action, "halt");
    assert.equal(next.milestone, "M1");
    assert.match(next.reason, /after 3 attempts/);
    const r = ship("milestone", "start", "M1");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no attempts left/);
    const halted = ship(
      "milestone",
      "finish",
      "M1",
      "--status",
      "halted",
      "--reason",
      "gates exhausted"
    );
    assert.equal(halted.code, 0, halted.stderr);
    assert.equal(milestones().milestones.M1.status, "halted");
    assert.equal(milestones().milestones.M1.attempts, 3);
    assert.equal(
      ship("milestone", "finish", "M1", "--status", "done", "--commit", SHA1)
        .code,
      1
    );
  });

  test("an interrupted attempt is resumed as a retry", () => {
    ship("milestone", "start", "M1");
    const next = ship("milestone", "next").json();
    assert.equal(next.action, "retry");
    assert.equal(next.milestone, "M1");
    assert.equal(next.attempt, 2);
  });

  test("a halted milestone stops the loop", () => {
    ship("milestone", "start", "M1");
    ship(
      "milestone",
      "finish",
      "M1",
      "--status",
      "halted",
      "--reason",
      "plan ambiguity"
    );
    const next = ship("milestone", "next").json();
    assert.equal(next.action, "halt");
    assert.equal(next.reason, "plan ambiguity");
  });

  test("--milestone selects one milestone and reports blocked dependencies", () => {
    assert.equal(
      ship("milestone", "next", "--milestone", "M3").json().milestone,
      "M3"
    );
    const blocked = ship("milestone", "next", "--milestone", "M2").json();
    assert.equal(blocked.action, "blocked");
    assert.match(blocked.reason, /depends on M1/);
    assert.equal(
      ship("milestone", "next", "--milestone", "next").json().milestone,
      "M1"
    );
    assert.equal(ship("milestone", "next", "--milestone", "M9").code, 2);
  });

  test("finish validates its input", () => {
    assert.equal(
      ship("milestone", "finish", "M1", "--status", "done", "--commit", SHA1)
        .code,
      1
    );
    ship("milestone", "start", "M1");
    assert.equal(ship("milestone", "finish", "M1", "--status", "done").code, 2);
    assert.equal(ship("milestone", "finish", "M1", "--status", "weird").code, 2);
    assert.equal(
      ship("milestone", "finish", "M1", "--status", "done", "--commit", "nope")
        .code,
      2
    );
    assert.equal(ship("milestone", "start").code, 2);
  });

  test("--parallel returns runnable milestones with disjoint files", () => {
    const next = ship("milestone", "next", "--parallel").json();
    assert.deepEqual(next.batch, ["M1", "M3"]);
  });
});

describe("nextStep", () => {
  const make = (entries, max = 2) => ({
    max_retries: max,
    order: Object.keys(entries),
    milestones: Object.fromEntries(
      Object.entries(entries).map(([id, m]) => [
        id,
        {
          status: "pending",
          attempts: 0,
          depends: [],
          files: [],
          commit: null,
          ...m
        }
      ])
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
    assert.deepEqual(
      nextStep(make({ M1: { files: ["a"] }, M2: { files: ["b"] } })).batch,
      ["M1"]
    );
  });

  test("filesOverlap matches files, directories and path separators", () => {
    assert.equal(filesOverlap(["src\\a.js"], ["./src/a.js"]), true);
    assert.equal(filesOverlap(["src/"], ["src/x/y.js"]), true);
    assert.equal(filesOverlap(["src/ab.js"], ["src/a"]), false);
  });
});

describe("milestone models", () => {
  test("complexity selects the builder entry, --model overrides it", () => {
    const { config } = loadConfig({
      snapshot: undefined,
      projectDir: undefined,
      env: { ESP_SKILLS_HOME: "/nonexistent-esp" }
    });
    assert.deepEqual(resolveModels(config, "low").builder, { model: "sonnet" });
    assert.deepEqual(resolveModels(config, "high").builder, {
      model: "opus",
      effort: "high"
    });
    assert.deepEqual(
      resolveModels(config, "high", { model: "haiku" }).builder,
      { model: "haiku" }
    );
    assert.deepEqual(resolveModels(config, "low").verifier, {
      model: "sonnet"
    });
    assert.deepEqual(resolveModels({ defaults: {} }, "low").builder, {
      model: "opus",
      source: "frontmatter"
    });
  });

  test("the CLI reads the frozen snapshot", () => {
    writeFileSync(
      join(runDir, "plan.md"),
      planText(1, [milestone("M1"), milestone("M3", { complexity: "high" })])
    );
    const snap = join(tmp, "snap.json");
    writeFileSync(
      snap,
      JSON.stringify({
        version: 1,
        defaults: {
          models: { builder: { high: { model: "fable", effort: "max" } } }
        }
      })
    );
    ship("milestone", "init", "--config-snapshot", snap);
    assert.deepEqual(ship("milestone", "models", "M3").json().builder, {
      model: "fable",
      effort: "max"
    });
    assert.deepEqual(ship("milestone", "models", "M1").json().builder, {
      model: "sonnet"
    });
    assert.deepEqual(
      ship("milestone", "models", "M1", "--model", "opus", "--effort", "low").json()
        .builder,
      { model: "opus", effort: "low" }
    );
    assert.equal(ship("milestone", "models", "M1", "--model", "gpt").code, 2);
  });
});

describe("milestone gates", () => {
  let project;
  beforeEach(() => {
    project = join(tmp, "project");
    mkdirSync(project);
  });
  const write = (name, text) => writeFileSync(join(project, name), text);

  test("detects package.json scripts with the lockfile package manager", () => {
    write(
      "package.json",
      JSON.stringify({
        scripts: {
          test: "node --test",
          lint: "eslint .",
          "type-check": "tsc",
          build: "vite build"
        }
      })
    );
    write("pnpm-lock.yaml", "");
    assert.deepEqual(detectGates(project), {
      test: "pnpm test",
      lint: "pnpm lint",
      typecheck: "pnpm type-check",
      build: "pnpm build"
    });
  });

  test("npm placeholder test script is not a gate", () => {
    write(
      "package.json",
      JSON.stringify({
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
          lint: "x"
        }
      })
    );
    assert.deepEqual(detectGates(project), {
      test: null,
      lint: "npm run lint",
      typecheck: null,
      build: null
    });
  });

  test("detects pyproject, cargo, go and make projects", () => {
    write("pyproject.toml", "[tool.pytest.ini_options]\n[tool.ruff]\n");
    assert.deepEqual(detectGates(project), {
      test: "uv run pytest",
      lint: "uv run ruff check",
      typecheck: null,
      build: null
    });
    rmSync(join(project, "pyproject.toml"));
    write("Cargo.toml", "[package]\n");
    assert.equal(detectGates(project).lint, "cargo clippy");
    rmSync(join(project, "Cargo.toml"));
    write("go.mod", "module x\n");
    assert.equal(detectGates(project).test, "go test ./...");
    rmSync(join(project, "go.mod"));
    write("Makefile", "test:\n\techo ok\nbuild:\n\techo ok\n");
    assert.deepEqual(detectGates(project), {
      test: "make test",
      lint: null,
      typecheck: null,
      build: "make build"
    });
  });

  test("configured gates win over detected ones", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } })
    );
    mkdirSync(join(project, ".esp-skills"));
    write(
      ".esp-skills/config.json",
      JSON.stringify({
        version: 1,
        ship: { gates: { lint: "npm run lint:strict" } }
      })
    );
    const r = cli(SCRIPT, ["milestone", "gates", "--project-dir", project]);
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.deepEqual(out.gates, {
      test: "npm test",
      lint: "npm run lint:strict",
      typecheck: null,
      build: null
    });
    assert.deepEqual(out.sources, {
      test: "detected",
      lint: "config",
      typecheck: "none",
      build: "none"
    });
  });
});
