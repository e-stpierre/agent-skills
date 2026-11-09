import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { budgetCheck, GoError, milestoneBudget, phaseModel, prLoopAction, prOptions, resolvePhases, reviewLoop } from "../go.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "go.mjs");
const LIGHT = join(HERE, "..", "go-light.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const REFERENCE = join(HERE, "..", "..", "references", "plan-format.md");
const NOW = "2026-11-08T12:00:00.000Z";

let tmp;
let home;
let repo;
let runDir;

function cli(script, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW, ...extraEnv }
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

const go = (...args) => cli(SCRIPT, [...args, "--run-dir", runDir]);
const state = () => JSON.parse(readFileSync(join(runDir, "go.json"), "utf8"));
const runJson = () => JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
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
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", message);
  return git("rev-parse", "HEAD");
}

function userConfig(config) {
  writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, ...config }));
}

function writeStep(name, block) {
  const r = cli(RUNS, ["result", name, "--run-dir", runDir, "--json", JSON.stringify(block)]);
  assert.equal(r.code === 0 || r.code > 2, true, r.stderr);
}

const done = (outputs = {}, extra = {}) => ({ status: "done", summary: "ok", outputs, ...extra });

function init(...extra) {
  const r = go("init", "--request", "Add OAuth login", "--base", "main", "--project-dir", repo, ...extra);
  assert.equal(r.code, 0, r.stderr);
  return r.json();
}

function examplePlan() {
  const text = readFileSync(REFERENCE, "utf8");
  const example = text.slice(text.indexOf("## Example"));
  const m = /```markdown\r?\n([\s\S]*?)\r?\n```\s*$/.exec(example);
  assert.ok(m, "plan-format.md has an example plan");
  const path = join(runDir, "plan.md");
  writeFileSync(path, `${m[1]}\n`);
  return path;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-go-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  commit("a.txt", "a\n", "init");
  git("switch", "-qc", "feature/oauth");
  const created = cli(RUNS, ["create", "oauth", "--root", join(tmp, "runs"), "--workflow", "esp-go"]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolvePhases", () => {
  test("keeps the canonical order and requires build", () => {
    const { phases } = resolvePhases(["merge", "build", "plan", "pr", "review", "branch", "fix-review", "await-review"]);
    assert.deepEqual(phases, ["plan", "branch", "build", "review", "pr", "await-review", "fix-review", "merge"]);
    assert.throws(() => resolvePhases(["plan", "pr"]), GoError);
  });

  test("applies --no-pr, --no-merge and internal_review_rounds 0", () => {
    const noPr = resolvePhases(undefined, { noPr: true });
    assert.deepEqual(noPr.phases, ["plan", "branch", "build", "review"]);
    assert.equal(noPr.skipped.merge, "--no-pr");
    assert.deepEqual(resolvePhases(undefined, { noMerge: true }).phases.at(-1), "fix-review");
    const noReview = resolvePhases(undefined, { reviewRounds: 0 });
    assert.equal(noReview.phases.includes("review"), false);
    assert.match(noReview.skipped.review, /internal_review_rounds/);
    assert.equal(resolvePhases(["plan", "build", "merge"]).skipped.merge, "needs the pr phase");
  });
});

describe("init", () => {
  test("creates go.json and freezes the config", () => {
    const out = init();
    assert.equal(out.created, true);
    const s = state();
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
  });

  test("reads go config and the flags", () => {
    userConfig({ go: { internal_review_rounds: 1, worktree: true }, "fix-review": { max_rounds: 5 } });
    init("--no-merge", "--interactive", "plan", "--max-rounds", "2");
    const s = state();
    assert.equal(s.internal_review_rounds, 1);
    assert.equal(s.use_worktree, true);
    assert.equal(s.pr_rounds.max, 2);
    assert.equal(s.interactive, "plan");
    assert.equal(s.phase_status.merge, "skipped");
  });

  test("is idempotent and validates its options", () => {
    assert.equal(go("init", "--project-dir", repo).code, 2);
    assert.equal(go("init", "--request", "x", "--project-dir", repo, "--interactive", "sometimes").code, 2);
    init();
    const again = go("init");
    assert.equal(again.code, 0);
    assert.equal(again.json().created, false);
  });

  test("picks up an esp-go-light escalation in the same run", () => {
    cli(RUNS, ["update", "--run-dir", runDir, "--status", "running"]);
    const light = (...args) => cli(LIGHT, [...args, "--run-dir", runDir]);
    assert.equal(light("init", "--request", "Add OAuth login with a session store", "--base", "main", "--project-dir", repo).code, 0);
    light("phase", "branch", "--status", "done", "--branch", "feature/oauth");
    writeFileSync(join(repo, "b.txt"), "work in progress\n");
    const escalated = light("escalate", "--trigger", "files", "--reason", "12 files estimated");
    assert.equal(escalated.code, 30, escalated.stderr);
    writeStep("go-light", JSON.parse(escalated.stdout));
    cli(RUNS, ["update", "--run-dir", runDir, "--status", "halted"]);

    const out = go("init", "--project-dir", repo);
    assert.equal(out.code, 0, out.stderr);
    const s = state();
    assert.equal(s.request, "Add OAuth login with a session store");
    assert.equal(s.branch, "feature/oauth");
    assert.equal(s.base, "main");
    assert.equal(s.escalated_from.trigger, "files");
    assert.equal(s.escalated_from.patch, join(runDir, "escalation.patch"));
    assert.match(s.escalated_from.stash, /esp-go-light escalation/);
    assert.equal(s.config_snapshot, join(runDir, "config.snapshot.json"));
    assert.equal(runJson().status, "running");
    assert.ok(jsonl("events.jsonl").some((e) => e.type === "run.resumed" && e.data.from === "esp-go-light"));
  });
});

describe("next and phase", () => {
  test("dispatches each phase with its role model", () => {
    init();
    let next = go("next").json();
    assert.equal(next.phase, "plan");
    assert.equal(next.skill, "esp-plan");
    assert.equal(next.role, "planner");
    assert.equal(next.model, "opus");
    assert.equal(next.effort, "high");
    assert.equal(next.cwd, repo);
    assert.equal(go("phase", "plan", "--status", "started").code, 0);
    assert.equal(go("next").json().resumed, true);

    const planned = go("phase", "plan", "--status", "done", "--plan", examplePlan()).json();
    assert.deepEqual(planned.milestones, { count: 2, max_milestones: 12, exceeded: false, action: "continue" });
    assert.equal(state().plan_title, "Add OAuth login");
    assert.deepEqual(state().milestones, ["M1", "M2"]);
    assert.ok(state().summary);

    next = go("next").json();
    assert.equal(next.phase, "branch");
    assert.equal(next.model, "haiku");
    go("phase", "branch", "--status", "done", "--branch", "feature/oauth");
    assert.equal(runJson().branch, "feature/oauth");
    next = go("next").json();
    assert.equal(next.phase, "build");
    assert.equal(next.model, "sonnet");
    assert.equal(next.build_resume, false);
    writeFileSync(join(runDir, "state.json"), "{}");
    assert.equal(go("next").json().build_resume, true);
  });

  test("dispatches the review loop and the pull request phases", () => {
    init();
    for (const p of ["plan", "branch", "build"]) go("phase", p, "--status", "done");
    let next = go("next").json();
    assert.equal(next.phase, "review");
    assert.equal(next.sub, "review");
    assert.equal(next.loop.step, "review-1");
    writeStep("review-1", done({ findings: 2, by_severity: { critical: 0 }, findings_path: "x.json" }));
    next = go("next").json();
    assert.equal(next.sub, "review-fix");
    assert.equal(next.skill, "esp-fix-review");
    assert.equal(next.role, "fixer");
    assert.equal(next.loop.findings_path, "x.json");
    writeStep("fix-review-1", done({ mode: "internal", fixed: 2, remaining: 0 }));
    assert.equal(go("next").json().loop.step, "review-2");
    writeStep("review-2", done({ findings: 0 }));
    next = go("next").json();
    assert.equal(next.action, "complete");
    go("phase", "review", "--status", "done");
    next = go("next").json();
    assert.equal(next.phase, "pr");
    assert.equal(next.draft, true);
    assert.equal(next.mark_ready, true);
    go("phase", "pr", "--status", "done", "--pr", "https://github.com/o/r/pull/7");
    assert.equal(runJson().pr, "https://github.com/o/r/pull/7");
    next = go("next").json();
    assert.equal(next.phase, "await-review");
    assert.equal(next.model, null);
    go("phase", "await-review", "--status", "done");
    next = go("next").json();
    assert.equal(next.phase, "fix-review");
    assert.equal(next.rounds, 1);
  });

  test("halts on the wall time budget", () => {
    userConfig({ go: { budgets: { max_wall_minutes: 1 } } });
    init();
    const later = cli(SCRIPT, ["next", "--run-dir", runDir], { ESP_RUNS_NOW: "2026-11-08T12:05:00.000Z" }).json();
    assert.equal(later.action, "halt");
    assert.equal(later.key, "budget");
  });
});

describe("loops", () => {
  const base = { internal_review_rounds: 2, halt_on: ["critical-security"], interactive: "off" };
  const step = (name, result) => ({ step: `01-${name}`, name, result });

  test("reviewLoop ends on a clean review, the last round, or a round that fixed nothing", () => {
    assert.equal(reviewLoop(null, { ...base, internal_review_rounds: 0 }, []).action, "done");
    assert.equal(reviewLoop(null, base, []).step, "review-1");
    const found = step("review-1", done({ findings: 1, by_severity: { critical: 0 } }));
    assert.equal(reviewLoop(null, base, [found]).action, "fix");
    assert.equal(reviewLoop(null, base, [step("review-1", done({ findings: 0 }))]).action, "done");
    const nothing = reviewLoop(null, base, [found, step("fix-review-1", done({ fixed: 0, remaining: 1 }))]);
    assert.equal(nothing.action, "done");
    assert.equal(nothing.remaining, 1);
    const found2 = step("review-2", done({ findings: 1, by_severity: { critical: 0 } }));
    const last = reviewLoop(null, base, [found, step("fix-review-1", done({ fixed: 1 })), found2, step("fix-review-2", done({ fixed: 1, remaining: 0 }))]);
    assert.equal(last.action, "done");
    assert.equal(last.exhausted, true);
  });

  test("reviewLoop halts on critical findings left, and stops on a failed step", () => {
    const critical = step("review-1", done({ findings: 1, by_severity: { critical: 1 } }));
    const one = { ...base, internal_review_rounds: 1 };
    const halted = reviewLoop(null, one, [critical, step("fix-review-1", done({ fixed: 0, remaining: 1 }))]);
    assert.equal(halted.action, "halt");
    assert.equal(halted.key, "critical-security");
    assert.equal(reviewLoop(null, { ...one, halt_on: [] }, [critical, step("fix-review-1", done({ fixed: 0, remaining: 1 }))]).action, "done");
    assert.equal(reviewLoop(null, base, [step("review-1", { status: "failed", summary: "x" })]).action, "stop");
  });

  test("prLoopAction rounds: await, fix, re-await while commits are pushed", () => {
    const s = { pr_rounds: { max: 2, done: 0, commits: 0 }, interactive: "off" };
    assert.equal(prLoopAction(s, "await", done()).action, "fix");
    const timedOut = prLoopAction(s, "await", { status: "awaiting-human", summary: "t" });
    assert.equal(timedOut.action, "fix");
    assert.equal(timedOut.timed_out, true);
    assert.equal(prLoopAction({ ...s, interactive: "all" }, "await", { status: "awaiting-human", summary: "t" }).action, "stop");
    const pushed = prLoopAction(s, "fix", done({ rounds: 1, commits: ["a"], open: 0 }));
    assert.equal(pushed.action, "await");
    assert.deepEqual(pushed.update, { done: 1, commits: 1 });
    const quiet = prLoopAction({ ...s, pr_rounds: { max: 2, done: 1, commits: 1 } }, "fix", done({ rounds: 2, commits: ["a"], open: 0 }));
    assert.equal(quiet.action, "merge");
    const open = prLoopAction(s, "fix", done({ rounds: 1, commits: [], open: 2 }));
    assert.equal(open.action, "stop");
    assert.equal(open.status, "awaiting-human");
    assert.equal(prLoopAction({ ...s, pr_rounds: { max: 1, done: 0, commits: 0 } }, "fix", done({ rounds: 1, commits: ["a"] })).action, "merge");
  });

  test("pr-loop records the rounds and the stop", () => {
    init();
    writeStep("fix-review", done({ mode: "pr", rounds: 1, commits: ["a"], open: 1 }));
    const out = go("pr-loop", "--after", "fix").json();
    assert.equal(out.action, "stop");
    assert.equal(state().pr_rounds.done, 1);
    assert.equal(state().stop.status, "awaiting-human");
    assert.equal(go("next").json().action, "result");
    assert.equal(go("pr-loop", "--after", "merge").code, 2);
  });
});

describe("helpers", () => {
  test("phaseModel, prOptions, milestoneBudget and budgetCheck", () => {
    const config = { defaults: { models: { planner: { model: "opus", effort: "high" }, mechanical: { model: "haiku" } } } };
    assert.deepEqual(phaseModel(config, "plan"), { role: "planner", model: "opus", effort: "high" });
    assert.deepEqual(phaseModel(config, "merge"), { role: "fixer", model: "inherit" });
    assert.deepEqual(phaseModel(config, "await-review"), { role: null, model: null });
    assert.deepEqual(prOptions({ pr_draft_until_reviewed: false }, { pr: { draft: true } }), { draft: true, mark_ready: false });
    assert.deepEqual(prOptions({ pr_draft_until_reviewed: false }, {}), { draft: false, mark_ready: false });
    const big = { milestones: ["M1", "M2", "M3"], max_milestones: 2, halt_on: ["budget"] };
    assert.equal(milestoneBudget(big).action, "halt");
    assert.equal(milestoneBudget({ ...big, halt_on: [] }).action, "continue-over-budget");
    const b = budgetCheck({ created_at: NOW, max_wall_minutes: 10, halt_on: [] }, new Date("2026-11-08T12:30:00.000Z"));
    assert.equal(b.action, "continue-over-budget");
  });
});

describe("worktree", () => {
  test("creates the task worktree under worktrees.root and records it", () => {
    userConfig({ worktrees: { root: join(tmp, "worktrees") } });
    init("--base-sha", git("rev-parse", "HEAD"));
    const out = go("worktree", "--branch", "feature/oauth-wt", "--from", "main");
    assert.equal(out.code, 0, out.stderr);
    const { path, created } = out.json();
    assert.equal(created, true);
    assert.ok(existsSync(join(path, "a.txt")));
    assert.equal(state().worktree, path);
    assert.equal(state().project_dir, path);
    assert.equal(go("next").json().cwd, path);
    assert.equal(go("worktree", "--branch", "feature/oauth-wt").json().created, false);
    git("worktree", "remove", "--force", path);
  });
});

describe("halt and result", () => {
  test("halt logs a Halt decision and skips the remaining phases", () => {
    init();
    const out = go("halt", "--key", "scope-change", "--reason", "the plan changes the public API");
    assert.equal(out.code, 20, out.stderr);
    const block = JSON.parse(out.stdout);
    assert.equal(block.status, "halted");
    assert.equal(jsonl("decisions.jsonl")[0]["x-esp-class"], "Halt");
    assert.equal(state().phase_status.merge, "skipped");
    assert.equal(go("next").json().action, "result");
    const result = go("result");
    assert.equal(result.code, 20);
    assert.equal(JSON.parse(result.stdout).status, "halted");
  });

  test("result follows the last step that ran, and merged wins", () => {
    init();
    commit("m1.txt", "1\n", "feat: M1 add the provider");
    commit("m2.txt", "2\n", "feat: M2 add the route");
    writeFileSync(
      join(runDir, "state.json"),
      JSON.stringify({ order: ["M1", "M2"], milestones: { M1: { title: "Add the provider", status: "done", commit: "1111111" }, M2: { title: "Add the route", status: "done", commit: "2222222" } } })
    );
    writeStep("build", done({ milestones_done: ["M1", "M2"], milestones_remaining: [] }));
    writeStep("review-1", done({ findings: 0 }));
    writeStep("await-review", { status: "awaiting-human", summary: "timed out" });
    writeStep("fix-review", done({ mode: "pr", rounds: 1, fixed: 1, commits: ["c"] }));
    let block = go("result").json();
    assert.equal(block.status, "done");
    assert.deepEqual(block.outputs.milestone_commits, { M1: "1111111", M2: "2222222" });
    assert.equal(block.outputs.commits.length, 2);
    assert.equal(block.outputs.internal_review.rounds, 1);
    writeStep("merge", { status: "merged", summary: "merged", outputs: { outcome: "merged", merged: true, method: "squash" } });
    const merged = go("result");
    assert.equal(merged.code, 0);
    block = JSON.parse(merged.stdout);
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.merge.method, "squash");
  });

  test("a recorded stop sets the status and the blockers", () => {
    init();
    writeStep("build", done());
    go("stop", "--status", "awaiting-human", "--reason", "2 review items open");
    const out = go("result");
    assert.equal(out.code, 10);
    const block = JSON.parse(out.stdout);
    assert.equal(block.status, "awaiting-human");
    assert.deepEqual(block.blockers, ["2 review items open"]);
  });
});

describe("pr-body", () => {
  test("builds the body from the plan, the build state and the decisions", () => {
    init();
    go("phase", "plan", "--status", "done", "--plan", examplePlan());
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ order: ["M1", "M2"], milestones: { M1: { title: "Add the provider", status: "done", commit: "1111111abc" }, M2: { title: "Add the route", status: "done", commit: "2222222abc" } } }));
    cli(RUNS, ["decision", "--run-dir", runDir, "--json", JSON.stringify({ phase: "build", source: "agent", risk: "high", decision: "Store tokens encrypted", rationale: "B-Decide" })]);
    const body = go("pr-body").stdout;
    assert.match(body, /^## Summary\n\n/);
    assert.match(body, /## Milestones\n\n- M1: Add the provider \(1111111\)\n- M2: Add the route \(2222222\)/);
    assert.match(body, /D001 \(high\): Store tokens encrypted/);
    const out = go("pr-body", "--summary", "Adds OAuth.", "--out", join(runDir, "pr-body.md")).json();
    assert.ok(out.bytes > 0);
    assert.match(readFileSync(join(runDir, "pr-body.md"), "utf8"), /^## Summary\n\nAdds OAuth\./);
  });
});
