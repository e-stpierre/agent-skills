import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { budgetCheck, gateFailureAction, GoLightError, resolvePhases, scopeCheck } from "../go-light.mjs";
import { validateArtifact } from "../lib/contract.mjs";
import { renderPrBody } from "../lib/pr-body.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "go-light.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
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

const light = (...args) => cli(SCRIPT, [...args, "--run-dir", runDir]);
const state = () => JSON.parse(readFileSync(join(runDir, "go-light.json"), "utf8"));
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

function init(...extra) {
  const r = light("init", "--request", "Add a greeting", "--base", "main", "--project-dir", repo, ...extra);
  assert.equal(r.code, 0, r.stderr);
  return r.json();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-go-light-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  commit("a.txt", "a\n", "init");
  git("switch", "-qc", "feature/greeting");
  const created = cli(RUNS, ["create", "greeting", "--root", join(tmp, "runs"), "--workflow", "esp-go-light"]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolvePhases", () => {
  test("keeps the canonical order", () => {
    const { phases, skipped } = resolvePhases(["merge", "implement", "context", "pr", "branch", "fix-review", "await-review"]);
    assert.deepEqual(phases, ["context", "branch", "implement", "pr", "await-review", "fix-review", "merge"]);
    assert.deepEqual(skipped, {});
  });

  test("skips the wait phases without pr, and with --stop-before-wait", () => {
    assert.deepEqual(resolvePhases(["context", "implement", "merge"]).phases, ["context", "implement"]);
    assert.equal(resolvePhases(["context", "implement", "merge"]).skipped.merge, "needs the pr phase");
    const stopped = resolvePhases(undefined, { stopBeforeWait: true });
    assert.deepEqual(stopped.phases, ["context", "branch", "implement", "pr"]);
    assert.match(stopped.skipped["await-review"], /stop-before-wait/);
  });

  test("requires implement", () => {
    assert.throws(() => resolvePhases(["context", "pr"]), GoLightError);
  });
});

describe("init", () => {
  test("creates go-light.json and freezes the config", () => {
    const out = init();
    assert.equal(out.created, true);
    const s = state();
    assert.equal(s.request, "Add a greeting");
    assert.equal(s.base, "main");
    assert.equal(s.base_sha, git("rev-parse", "HEAD"));
    assert.equal(s.max_files_changed, 10);
    assert.equal(s.escalate_to_go, true);
    assert.equal(s.max_wall_minutes, 60);
    assert.deepEqual(s.phases, ["context", "branch", "implement", "pr", "await-review", "fix-review", "merge"]);
    assert.ok(existsSync(join(runDir, "config.snapshot.json")));
    assert.equal(s.config_snapshot, join(runDir, "config.snapshot.json"));
  });

  test("reads go-light config and --stop-before-wait", () => {
    userConfig({ "go-light": { max_files_changed: 3, escalate_to_go: false, phases: ["context", "implement", "pr", "merge"] } });
    init("--stop-before-wait");
    const s = state();
    assert.equal(s.max_files_changed, 3);
    assert.equal(s.escalate_to_go, false);
    assert.equal(s.stop_before_wait, true);
    assert.deepEqual(s.phases, ["context", "implement", "pr"]);
    assert.equal(s.phase_status.branch, "skipped");
    assert.equal(s.phase_status.merge, "skipped");
  });

  test("is idempotent, and requires --request on the first call", () => {
    assert.equal(light("init").code, 2);
    init();
    const again = light("init");
    assert.equal(again.code, 0);
    assert.equal(again.json().created, false);
    assert.equal(again.json().request, "Add a greeting");
  });

  test("uses a given snapshot", () => {
    const snap = join(tmp, "snap.json");
    writeFileSync(snap, JSON.stringify({ version: 1, "go-light": { max_files_changed: 2 } }));
    init("--config-snapshot", snap);
    assert.equal(state().config_snapshot, snap);
    assert.equal(state().max_files_changed, 2);
    assert.equal(existsSync(join(runDir, "config.snapshot.json")), false);
  });
});

describe("phase", () => {
  test("records facts, emits events and updates run.json", () => {
    init();
    assert.equal(light("phase", "context", "--status", "done", "--summary", "Adds hello()").code, 0);
    const sha = git("rev-parse", "HEAD");
    const branch = light("phase", "branch", "--status", "done", "--branch", "feature/greeting", "--base-sha", sha);
    assert.equal(branch.json().next, "implement");
    const c = commit("b.txt", "b\n", "Add greeting");
    light("phase", "implement", "--status", "done", "--commit", c, "--gates", '{"test":"pass","lint":"skipped"}');
    const pr = light("phase", "pr", "--status", "done", "--pr", "https://github.com/o/r/pull/7");
    assert.equal(pr.json().next, "await-review");
    const s = state();
    assert.equal(s.summary, "Adds hello()");
    assert.equal(s.commit, c);
    assert.deepEqual(s.gates, { test: "pass", lint: "skipped" });
    const types = jsonl("events.jsonl").map((e) => e.type);
    assert.deepEqual(types.slice(1), ["branch.created", "commit.created", "pr.opened"]);
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
    assert.equal(run.branch, "feature/greeting");
    assert.equal(run.pr, "https://github.com/o/r/pull/7");
    assert.equal(cli(RUNS, ["validate", join(runDir, "events.jsonl")]).code, 0);
  });

  test("rejects unknown phases and statuses", () => {
    init();
    assert.equal(light("phase", "deploy", "--status", "done").code, 2);
    assert.equal(light("phase", "pr", "--status", "pending").code, 2);
    assert.equal(light("phase", "pr", "--status", "done", "--commit", "nope").code, 2);
  });
});

describe("limits", () => {
  test("scope counts tracked and untracked changes", () => {
    userConfig({ "go-light": { max_files_changed: 2 } });
    init();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "b.txt"), "new\n");
    const ok = light("scope").json();
    assert.deepEqual(ok.files, ["a.txt", "b.txt"]);
    assert.equal(ok.exceeded, false);
    assert.equal(ok.action, "continue");
    writeFileSync(join(repo, "c.txt"), "new\n");
    const over = light("scope").json();
    assert.equal(over.count, 3);
    assert.equal(over.action, "escalate");
    assert.equal(light("scope", "--estimate", "5").json().action, "escalate");
    assert.equal(light("scope", "--estimate", "1").json().action, "continue");
  });

  test("scopeCheck continues over the limit when escalation is off", () => {
    const s = { max_files_changed: 1, escalate_to_go: false };
    assert.equal(scopeCheck(s, ["a", "b"]).action, "continue-over-limit");
  });

  test("the second gate failure escalates, or halts without escalation", () => {
    init();
    assert.equal(light("gate-failure", "--reason", "test failed").json().action, "retry");
    const second = light("gate-failure", "--reason", "test failed").json();
    assert.equal(second.gate_failures, 2);
    assert.equal(second.action, "escalate");
    assert.deepEqual(state().gate_failure_reasons, ["test failed", "test failed"]);
    assert.equal(gateFailureAction({ gate_failures: 2, gate_failure_limit: 2, escalate_to_go: false }), "halt");
  });

  test("budget halts only when budget is in go.halt_on", () => {
    const s = { created_at: "2026-11-08T10:00:00.000Z", max_wall_minutes: 60, halt_on: ["budget"] };
    const at = new Date("2026-11-08T11:30:00.000Z");
    assert.deepEqual(budgetCheck(s, at), { elapsed_minutes: 90, max_wall_minutes: 60, exceeded: true, action: "halt" });
    assert.equal(budgetCheck({ ...s, halt_on: [] }, at).action, "continue-over-budget");
    assert.equal(budgetCheck(s, new Date("2026-11-08T10:30:00.000Z")).action, "continue");
    assert.equal(budgetCheck({ ...s, max_wall_minutes: null }, at).exceeded, false);
  });
});

describe("escalate", () => {
  test("saves a patch, stashes the work, logs the decision and exits 30", () => {
    init();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    const r = light("escalate", "--trigger", "files", "--reason", "touches 14 files");
    assert.equal(r.code, 30, r.stderr);
    const block = r.json();
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "escalate");
    assert.deepEqual(block.files_changed, ["a.txt", "new.txt"]);
    const e = block.outputs.escalation;
    assert.equal(e.trigger, "files");
    assert.equal(e.stash, `esp-go-light escalation ${JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).id}`);
    assert.equal(block.outputs.next.skill, "esp-go");
    assert.equal(git("status", "--porcelain"), "");
    assert.match(git("stash", "list"), /esp-go-light escalation/);
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
    assert.equal(light("escalate", "--trigger", "gates", "--reason", "again").code, 1);
  });

  test("keeps the tree with --keep-tree, and a design escalation is an agent decision", () => {
    init();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    const r = light("escalate", "--trigger", "design", "--reason", "two storage designs", "--question", "SQL or KV?", "--keep-tree");
    assert.equal(r.code, 30);
    assert.equal(r.json().outputs.escalation.stash, null);
    assert.equal(r.json().outputs.escalation.question, "SQL or KV?");
    assert.notEqual(git("status", "--porcelain"), "");
    assert.equal(jsonl("decisions.jsonl")[0].source, "agent");
  });

  test("validates its arguments", () => {
    init();
    assert.equal(light("escalate", "--trigger", "mood", "--reason", "x").code, 2);
    assert.equal(light("escalate", "--trigger", "files").code, 2);
  });
});

describe("halt", () => {
  test("logs a Halt decision and exits 20", () => {
    init();
    const r = light("halt", "--key", "budget", "--reason", "60 minutes exceeded");
    assert.equal(r.code, 20, r.stderr);
    const block = r.json();
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "halted");
    assert.deepEqual(block.blockers, ["budget: 60 minutes exceeded"]);
    const [decision] = jsonl("decisions.jsonl");
    assert.equal(decision["x-esp-class"], "Halt");
    assert.equal(decision.risk, "high");
    assert.match(decision.rationale, /^Halt: budget/);
    assert.equal(light("halt", "--key", "boredom", "--reason", "x").code, 2);
  });
});

describe("result", () => {
  test("done after --stop-before-wait, with commits and gates", () => {
    init("--stop-before-wait");
    const c = commit("b.txt", "b\n", "Add greeting");
    light("phase", "implement", "--status", "done", "--commit", c, "--gates", '{"test":"pass"}');
    light("phase", "pr", "--status", "done", "--pr", "https://github.com/o/r/pull/7");
    const r = light("result");
    assert.equal(r.code, 0, r.stderr);
    const block = r.json();
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.status, "done");
    assert.equal(block.commit, c);
    assert.equal(block.pr, "https://github.com/o/r/pull/7");
    assert.deepEqual(block.files_changed, ["b.txt"]);
    assert.deepEqual(block.gates, { test: "pass" });
    assert.deepEqual(block.outputs.deferred_phases, ["await-review", "fix-review", "merge"]);
    assert.match(block.summary, /left to the caller/);
    const recorded = cli(RUNS, ["result", "go-light", "--run-dir", runDir, "--json", r.stdout]);
    assert.equal(recorded.code, 0, recorded.stderr);
  });

  test("merged from the merge step, with review fixes and follow-ups", () => {
    init();
    commit("b.txt", "b\n", "Add greeting");
    commit("b.txt", "b2\n", "fix(review): handle empty names");
    writeStep("fix-review", {
      status: "done",
      summary: "Fixed 1.",
      outputs: { mode: "pr", pr: 7, rounds: 1, fixed: 1, rejected: 1, deferred: 1, open: 0 },
      discovered_items: [{ type: "follow-up", title: "Localize the greeting" }]
    });
    writeStep("merge", { status: "merged", summary: "Merged.", outputs: { outcome: "merged", merged: true, method: "squash" } });
    const block = light("result").json();
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.review_fix_commits, 1);
    assert.equal(block.outputs.commits.length, 2);
    assert.equal(block.outputs.fix_review.fixed, 1);
    assert.equal(block.outputs.merge.method, "squash");
    assert.deepEqual(block.discovered_items, [{ type: "follow-up", title: "Localize the greeting" }]);
    assert.match(block.summary, /squash/);
  });

  test("passes an awaiting-human step through with its needs_input", () => {
    init();
    const needs = { id: "await-review-timeout", question: "Keep waiting?", options: [{ id: "wait", label: "Wait" }], recommended: "wait", blocking: true };
    writeStep("await-review", { status: "awaiting-human", summary: "Timed out.", needs_input: needs });
    const r = light("result");
    assert.equal(r.code, 10);
    assert.deepEqual(r.json().needs_input, needs);
    assert.equal(light("result", "--status", "failed", "--summary", "Gave up.").json().summary, "Gave up.");
    assert.equal(light("result", "--status", "nope").code, 2);
  });
});

describe("pr-body", () => {
  const artifacts = {
    decisions: [
      { id: "D001", phase: "implement", risk: "low", decision: "Used the existing logger", "x-esp-class": "A-Fix" },
      { id: "D002", phase: "implement", risk: "medium", decision: "Default name is World", "x-esp-class": "B-Decide" },
      { id: "D003", phase: "fix-review", risk: "low", decision: "Kept the helper inline", "x-esp-class": "Reject" },
      { id: "D004", phase: "merge", risk: "low", decision: "Merged with squash" }
    ],
    steps: [
      { name: "fix-review", result: { outputs: { mode: "pr", pr: 7, rounds: 2, fixed: 3, rejected: 1, deferred: 0 }, discovered_items: [{ type: "docs", title: "Document hello()" }] } }
    ],
    build: null
  };

  test("renders the sections from the run artifacts", () => {
    const body = renderPrBody(artifacts, { summary: "Adds hello()." });
    assert.match(body, /^## Summary\n\nAdds hello\(\)\./);
    assert.ok(body.indexOf("D002") < body.indexOf("D001"), "medium risk first");
    assert.doesNotMatch(body, /D004/);
    assert.match(body, /## Review Resolution\n\n- PR review #7: 3 fixed, 1 rejected, 2 rounds\n {2}- Rejected \(D003\): Kept the helper inline/);
    assert.match(body, /## Follow-ups\n\n- docs: Document hello\(\)/);
    assert.doesNotMatch(body, /## Milestones/);
    assert.match(body, /Generated with \[Claude Code\]/);
  });

  test("honors the section list and drops the attribution", () => {
    const body = renderPrBody(artifacts, { summary: "S", sections: ["summary", "follow-ups"], attribution: null });
    assert.equal(body, "## Summary\n\nS\n\n## Follow-ups\n\n- docs: Document hello()\n");
  });

  test("the CLI reads the run and the frozen config", () => {
    userConfig({ pr: { attribution: false } });
    init();
    light("phase", "context", "--status", "done", "--summary", "Adds hello().");
    cli(RUNS, ["decision", "--run-dir", runDir, "--json", JSON.stringify({ phase: "implement", source: "agent", risk: "medium", decision: "Default name is World", rationale: "B-Decide: smallest change", "x-esp-class": "B-Decide" })]);
    const r = light("pr-body");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /## Summary\n\nAdds hello\(\)\./);
    assert.match(r.stdout, /D001 \(B-Decide, medium\): Default name is World/);
    assert.doesNotMatch(r.stdout, /Generated with/);
    const out = join(tmp, "body.md");
    assert.equal(light("pr-body", "--out", out).code, 0);
    assert.equal(readFileSync(out, "utf8"), r.stdout);
  });
});
