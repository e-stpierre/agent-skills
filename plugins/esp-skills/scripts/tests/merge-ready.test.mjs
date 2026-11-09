import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../lib/contract.mjs";
import {
  acquireMergeLock,
  buildContext,
  classifyChecks,
  cmdMerge,
  evaluate,
  haltSignals,
  MergeError,
  mergePolicy,
  report,
  resolveMethod,
  run,
  waitForChecks
} from "../merge-ready.mjs";
import { appendDecision, validateFile } from "../runs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "merge-ready.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-08T12:00:00.000Z";
const HEAD = "d".repeat(40);
const URL = "https://github.com/o/r/pull/9";

let tmp;
let home;
let runDir;
const env = (extra = {}) => ({ ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW, AF_MERGE_LOCK: "", ...extra });

function cli(script, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...env(), ...extraEnv } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

function facts(overrides = {}) {
  return {
    pr: {
      number: 9,
      url: URL,
      state: "OPEN",
      draft: false,
      head: HEAD,
      branch: "feature/x",
      base: "main",
      cross_repository: false,
      mergeable: "MERGEABLE",
      merge_state: "CLEAN",
      review_decision: null,
      latest_reviews: [],
      auto_merge: false,
      ...overrides.pr
    },
    settings: { squash: true, rebase: true, merge: true, delete_branch_on_merge: false, merge_queue: false, in_merge_queue: false, ...overrides.settings },
    rules: overrides.rules ?? [],
    protection: overrides.protection === undefined ? { linear_history: false } : overrides.protection,
    checks: overrides.checks ?? [{ name: "test", bucket: "pass" }],
    required: overrides.required ?? [{ name: "test", bucket: "pass" }],
    threads: overrides.threads ?? [],
    compare: overrides.compare ?? { status: "ahead", ahead_by: 2, behind_by: 0 }
  };
}

function fakeClient(data = facts()) {
  const calls = { merge: [], deleteBranch: [] };
  return {
    calls,
    data,
    pr: () => ({ ...data.pr }),
    settings: () => ({ ...data.settings }),
    rules: () => data.rules,
    protection: () => data.protection,
    checks: (n, { required = false } = {}) => (required ? data.required : data.checks),
    unresolvedThreads: () => data.threads,
    compare: () => data.compare,
    merge: (number, opts) => {
      calls.merge.push({ number, ...opts });
      return "";
    },
    deleteBranch: (repo, branch) => {
      calls.deleteBranch.push({ repo, branch });
      return "deleted";
    }
  };
}

function ctx(client = fakeClient(), { options = {}, extraEnv = {}, io = {} } = {}) {
  return buildContext({ "run-dir": runDir, "project-dir": tmp, ...options }, env(extraEnv), {
    client,
    sleep: async () => {},
    inspectWorktree: () => ({ path: null, remove: false, reason: "not a linked worktree" }),
    log: () => {},
    ...io
  });
}

const jsonl = (name) =>
  existsSync(join(runDir, name))
    ? readFileSync(join(runDir, name), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-merge-"));
  home = join(tmp, "home");
  mkdirSync(home);
  const created = cli(RUNS, ["create", "toy", "--root", join(tmp, "runs"), "--project-dir", tmp]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const ALL = { squash: true, rebase: true, merge: true };

describe("method resolution", () => {
  test("rule 1: the policy combines repo settings, ruleset methods and linear history", () => {
    const policy = mergePolicy(
      { ...ALL, delete_branch_on_merge: true },
      [
        { type: "pull_request", parameters: { allowed_merge_methods: ["squash", "merge"] } },
        { type: "required_linear_history" }
      ],
      null
    );
    assert.deepEqual(policy.allowed, ["squash", "merge"]);
    assert.equal(policy.linear_history, true);
    assert.equal(policy.merge_queue, false);
    assert.equal(policy.delete_branch_on_merge, true);
    assert.equal(mergePolicy({ squash: true }, [], { linear_history: true }).linear_history, true);
  });

  test("rule 2: a merge queue enqueues and lets the queue decide", () => {
    const fromSettings = resolveMethod(mergePolicy({ ...ALL, merge_queue: true }));
    assert.equal(fromSettings.queue, true);
    assert.equal(fromSettings.method, "squash");
    assert.match(fromSettings.reason, /merge queue/);
    const fromRule = resolveMethod(mergePolicy(ALL, [{ type: "merge_queue", parameters: { merge_method: "REBASE" } }]));
    assert.equal(fromRule.queue, true);
    assert.equal(fromRule.method, "rebase");
  });

  test("rule 3: a single allowed method is used", () => {
    const out = resolveMethod(mergePolicy({ squash: false, rebase: true, merge: false }), { preference: ["squash", "merge"] });
    assert.equal(out.method, "rebase");
    assert.match(out.reason, /only method allowed/);
    assert.deepEqual(out.alternatives, []);
  });

  test("rule 4: several methods use the first allowed in preference, excluding merge under linear history", () => {
    const out = resolveMethod(mergePolicy({ squash: false, rebase: true, merge: true }), { preference: ["squash", "merge", "rebase"] });
    assert.equal(out.method, "merge");
    assert.deepEqual(out.alternatives, ["rebase"]);
    const linear = resolveMethod(mergePolicy({ squash: false, rebase: true, merge: true }, [{ type: "required_linear_history" }]), {
      preference: ["merge", "rebase"]
    });
    assert.equal(linear.method, "rebase");
    assert.match(linear.reason, /only method allowed.*linear history/);
  });

  test("rule 5: an explicit method overrides, and errors when it is not allowed", () => {
    assert.equal(resolveMethod(mergePolicy(ALL), { method: "rebase" }).method, "rebase");
    assert.throws(() => resolveMethod(mergePolicy({ squash: true }), { method: "merge" }), /not allowed: the repository does not allow it/);
    assert.throws(
      () => resolveMethod(mergePolicy(ALL, [{ type: "required_linear_history" }]), { method: "merge" }),
      /not allowed: linear history is required/
    );
    assert.throws(() => resolveMethod(mergePolicy(ALL), { method: "fast-forward" }), (err) => err instanceof MergeError && err.exitCode === 2);
  });

  test("no allowed method is an error", () => {
    assert.throws(() => resolveMethod(mergePolicy({ merge: true }, [{ type: "required_linear_history" }])), /No merge method is allowed/);
  });

  test("rule 6: the method and its reason are logged as a decision on merge", async () => {
    const client = fakeClient();
    const block = await cmdMerge(ctx(client), "9");
    const [decision] = jsonl("decisions.jsonl").filter((d) => d.phase === "merge");
    assert.equal(decision.decision, "Merged #9 with squash");
    assert.match(decision.rationale, /^Method: first allowed method in merge.preference/);
    assert.deepEqual(decision.alternatives, ["rebase", "merge"]);
    assert.equal(block.outputs.decision, decision.id);
  });
});

describe("conditions", () => {
  function evaluateFacts(f, config = {}) {
    const policy = { ...mergePolicy(f.settings, f.rules, f.protection), in_merge_queue: f.settings.in_merge_queue };
    const checks = classifyChecks(f.checks, f.required, { requireGreen: config.require_green_checks !== false });
    return evaluate({ pr: f.pr, policy, checks, threads: f.threads, compare: f.compare, halt: { known: false, reasons: [] } }, config);
  }
  const status = (out, name) => out.conditions.find((c) => c.name === name);

  test("every condition passes on a clean pull request", () => {
    const out = evaluateFacts(facts());
    assert.equal(out.ready, true);
    assert.equal(out.outcome, "ready");
    assert.deepEqual(
      out.conditions.map((c) => [c.name, c.status]),
      [
        ["open", "pass"],
        ["halt", "pass"],
        ["draft", "pass"],
        ["changes-requested", "pass"],
        ["threads", "pass"],
        ["checks", "pass"],
        ["up-to-date", "pass"],
        ["branch-protection", "pass"]
      ]
    );
  });

  test("draft, changes requested, unresolved threads and failing checks block with a reason", () => {
    const out = evaluateFacts(
      facts({
        pr: { draft: true, latest_reviews: [{ login: "alice", state: "CHANGES_REQUESTED" }] },
        threads: ["u1", "u2"],
        checks: [
          { name: "test", bucket: "fail" },
          { name: "lint", bucket: "pass" }
        ]
      })
    );
    assert.equal(out.outcome, "blocked");
    assert.equal(status(out, "draft").status, "fail");
    assert.match(status(out, "changes-requested").reason, /alice/);
    assert.match(status(out, "threads").reason, /2 unresolved/);
    assert.match(status(out, "checks").reason, /failing checks: test/);
  });

  test("require_resolved_threads false ignores threads; require_green_checks false only counts required checks", () => {
    const out = evaluateFacts(
      facts({ threads: ["u1"], checks: [{ name: "optional", bucket: "fail" }, { name: "test", bucket: "pass" }] }),
      { require_resolved_threads: false, require_green_checks: false }
    );
    assert.equal(out.outcome, "ready");
    assert.match(status(out, "threads").reason, /not required/);
    assert.match(status(out, "checks").reason, /required checks green/);
  });

  test("pending checks, including required checks that have not reported, give pending", () => {
    const out = evaluateFacts(facts({ checks: [], required: [{ name: "build", bucket: "pending" }] }), { require_green_checks: false });
    assert.equal(out.outcome, "pending");
    assert.deepEqual(status(out, "checks").pending, ["build"]);
  });

  test("behind the base asks for a rebase; conflicts are reported apart", () => {
    const behind = evaluateFacts(facts({ compare: { behind_by: 3 } }));
    assert.equal(behind.outcome, "behind");
    assert.match(status(behind, "up-to-date").reason, /behind main by 3/);
    const conflict = evaluateFacts(facts({ pr: { mergeable: "CONFLICTING" } }));
    assert.equal(conflict.outcome, "conflict");
  });

  test("a merge queue skips the up-to-date condition", () => {
    const out = evaluateFacts(facts({ settings: { merge_queue: true }, compare: { behind_by: 5 } }));
    assert.equal(status(out, "up-to-date").status, "pass");
    assert.equal(out.outcome, "ready");
  });

  test("unmet branch protection gives protected, but a BLOCKED state caused by pending checks does not", () => {
    const review = evaluateFacts(facts({ pr: { review_decision: "REVIEW_REQUIRED" } }));
    assert.equal(review.outcome, "protected");
    const blocked = evaluateFacts(facts({ pr: { merge_state: "BLOCKED" } }));
    assert.equal(blocked.outcome, "protected");
    const pending = evaluateFacts(facts({ pr: { merge_state: "BLOCKED" }, checks: [{ name: "test", bucket: "pending" }] }));
    assert.equal(pending.outcome, "pending");
    assert.equal(status(pending, "branch-protection").status, "pass");
  });

  test("closed and merged pull requests", () => {
    assert.equal(evaluateFacts(facts({ pr: { state: "CLOSED" } })).outcome, "closed");
    assert.equal(evaluateFacts(facts({ pr: { state: "MERGED" } })).outcome, "merged");
  });

  test("halt signals: run status, Halt decisions, and operator decisions that lift them", () => {
    assert.deepEqual(haltSignals(null), { known: false, reasons: [] });
    assert.deepEqual(haltSignals(runDir).reasons, []);
    const halt = appendDecision(runDir, { phase: "fix-review", source: "policy", risk: "high", decision: "Stopped", rationale: "Halt: critical-security", "x-esp-class": "Halt" }, env());
    assert.match(haltSignals(runDir).reasons[0], /^D001: Stopped/);
    appendDecision(runDir, { phase: "merge", source: "operator", risk: "low", decision: "Fixed by hand", rationale: "operator", refs: [halt.id] }, env());
    assert.deepEqual(haltSignals(runDir).reasons, []);
    const runPath = join(runDir, "run.json");
    writeFileSync(runPath, JSON.stringify({ ...JSON.parse(readFileSync(runPath, "utf8")), status: "halted" }));
    assert.deepEqual(haltSignals(runDir).reasons, ["run status is halted"]);
  });
});

describe("merge", () => {
  test("a ready pull request merges with the resolved method, deletes the branch, and logs it", async () => {
    const client = fakeClient();
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.status, "merged");
    assert.equal(validateArtifact("result", block).valid, true);
    assert.deepEqual(client.calls.merge, [{ number: 9, method: "squash", head: HEAD, auto: false }]);
    assert.deepEqual(client.calls.deleteBranch, [{ repo: "o/r", branch: "feature/x" }]);
    assert.equal(block.outputs.merged, true);
    assert.equal(block.outputs.cleanup.remote_branch, "deleted");
    assert.equal(block.pr, URL);
    const events = jsonl("events.jsonl").map((e) => e.type);
    assert.ok(events.includes("merge.completed"));
    assert.ok(!events.includes("merge.locked"));
    assert.equal(validateFile(join(runDir, "events.jsonl")).valid, true);
    assert.equal(validateFile(join(runDir, "decisions.jsonl")).valid, true);
  });

  test("the branch is kept for forks, with delete_branch false, and left to GitHub when it deletes on merge", async () => {
    const fork = fakeClient(facts({ pr: { cross_repository: true } }));
    assert.match((await cmdMerge(ctx(fork), "9")).outputs.cleanup.remote_branch, /fork/);
    const github = fakeClient(facts({ settings: { delete_branch_on_merge: true } }));
    assert.match((await cmdMerge(ctx(github), "9")).outputs.cleanup.remote_branch, /deleted by GitHub/);
    writeFileSync(join(home, "config.json"), JSON.stringify({ merge: { delete_branch: false } }));
    const kept = fakeClient();
    assert.match((await cmdMerge(ctx(kept), "9")).outputs.cleanup.remote_branch, /delete_branch false/);
    assert.equal(fork.calls.deleteBranch.length + github.calls.deleteBranch.length + kept.calls.deleteBranch.length, 0);
  });

  test("unmet branch protection yields awaiting-human and is never bypassed", async () => {
    const client = fakeClient(facts({ pr: { review_decision: "REVIEW_REQUIRED" } }));
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.status, "awaiting-human");
    assert.equal(block.outputs.outcome, "protected");
    assert.equal(block.needs_input.id, "merge-protected");
    assert.equal(block.needs_input.blocking, true);
    assert.equal(client.calls.merge.length, 0);
    assert.equal(validateArtifact("result", block).valid, true);
    const [decision] = jsonl("decisions.jsonl");
    assert.match(decision.decision, /Did not merge #9: protected/);
  });

  test("a halted run never merges", async () => {
    appendDecision(runDir, { phase: "build", source: "policy", risk: "high", decision: "Stopped M2", rationale: "Halt: gates-exhausted", "x-esp-class": "Halt" }, env());
    const client = fakeClient();
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.status, "halted");
    assert.equal(block.max_risk, "high");
    assert.equal(client.calls.merge.length, 0);
  });

  test("--halt records a Halt decision and reports halted", async () => {
    const client = fakeClient();
    const block = await cmdMerge(ctx(client), "9", { halt: "rebase conflict in src/a.js" });
    assert.equal(block.status, "halted");
    assert.deepEqual(block.blockers, ["rebase conflict in src/a.js"]);
    const [decision] = jsonl("decisions.jsonl");
    assert.equal(decision["x-esp-class"], "Halt");
    assert.equal(client.calls.merge.length, 0);
  });

  test("behind the base reports behind without merging", async () => {
    const client = fakeClient(facts({ compare: { behind_by: 1 } }));
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.outputs.outcome, "behind");
    assert.equal(block.status, "awaiting-human");
    assert.equal(client.calls.merge.length, 0);
  });

  test("an explicit method the repository does not allow fails the merge, not silently falls back", async () => {
    const client = fakeClient(facts({ settings: { merge: false } }));
    const block = await cmdMerge(ctx(client, { options: { method: "merge" } }), "9");
    assert.equal(block.status, "awaiting-human");
    assert.match(block.summary, /not allowed/);
    assert.equal(client.calls.merge.length, 0);
  });

  test("a merge queue enqueues with --auto; an already queued pull request is not enqueued again", async () => {
    const client = fakeClient(facts({ settings: { merge_queue: true } }));
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.status, "done");
    assert.equal(block.outputs.outcome, "queued");
    assert.equal(client.calls.merge[0].auto, true);
    assert.match(block.outputs.cleanup.remote_branch, /pending/);
    const queued = fakeClient(facts({ settings: { merge_queue: true, in_merge_queue: true } }));
    assert.equal((await cmdMerge(ctx(queued), "9")).outputs.already_queued, true);
    assert.equal(queued.calls.merge.length, 0);
  });

  test("use_auto_merge enables auto-merge while checks are pending", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ merge: { use_auto_merge: true } }));
    const client = fakeClient(facts({ checks: [{ name: "test", bucket: "pending" }], required: [{ name: "test", bucket: "pending" }] }));
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.outputs.outcome, "auto-merge");
    assert.equal(block.status, "done");
    assert.deepEqual(client.calls.merge, [{ number: 9, method: "squash", head: HEAD, auto: true }]);
  });

  test("merge.enabled false and --dry-run never merge", async () => {
    const dry = fakeClient();
    const block = await cmdMerge(ctx(dry), "9", { dryRun: true });
    assert.equal(block.outputs.outcome, "dry-run");
    assert.match(block.summary, /would merge with squash/);
    writeFileSync(join(home, "config.json"), JSON.stringify({ merge: { enabled: false } }));
    const disabled = fakeClient();
    assert.equal((await cmdMerge(ctx(disabled), "9")).outputs.outcome, "disabled");
    assert.equal(dry.calls.merge.length + disabled.calls.merge.length, 0);
  });

  test("an already merged pull request reports merged", async () => {
    const client = fakeClient(facts({ pr: { state: "MERGED" } }));
    const block = await cmdMerge(ctx(client), "9");
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.already_merged, true);
    assert.equal(client.calls.merge.length, 0);
  });
});

describe("merge lock", () => {
  test("with AF_MERGE_LOCK the lock is held during the merge and released after", async () => {
    const lockPath = join(tmp, "repo.merge.lock");
    const client = fakeClient();
    let heldDuringMerge = false;
    const merge = client.merge;
    client.merge = (...args) => {
      heldDuringMerge = existsSync(lockPath);
      return merge(...args);
    };
    const block = await cmdMerge(ctx(client, { extraEnv: { AF_MERGE_LOCK: lockPath } }), "9");
    assert.equal(block.status, "merged");
    assert.equal(heldDuringMerge, true);
    assert.equal(existsSync(lockPath), false);
    const locked = jsonl("events.jsonl").find((e) => e.type === "merge.locked");
    assert.equal(locked.data.lock, lockPath);
  });

  test("without a lock the merge runs directly", async () => {
    const client = fakeClient();
    await cmdMerge(ctx(client), "9");
    assert.ok(!jsonl("events.jsonl").some((e) => e.type === "merge.locked"));
    assert.equal(client.calls.merge.length, 1);
  });

  test("a busy lock times out without merging; a stale lock is taken over", async () => {
    const lockPath = join(tmp, "busy.lock");
    writeFileSync(lockPath, "{}");
    const client = fakeClient();
    const block = await cmdMerge(ctx(client), "9", { lock: lockPath, lockTimeoutMinutes: 0 });
    assert.equal(block.outputs.outcome, "lock-busy");
    assert.equal(block.status, "awaiting-human");
    assert.equal(client.calls.merge.length, 0);
    assert.equal(existsSync(lockPath), true);

    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    const stale = fakeClient();
    assert.equal((await cmdMerge(ctx(stale), "9", { lock: lockPath, lockTimeoutMinutes: 0 })).status, "merged");
    assert.equal(existsSync(lockPath), false);
  });

  test("acquireMergeLock waits for a release", async () => {
    const lockPath = join(tmp, "wait.lock");
    writeFileSync(lockPath, "{}");
    let sleeps = 0;
    const lock = await acquireMergeLock(lockPath, {
      timeoutMs: 60_000,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) rmSync(lockPath);
      }
    });
    assert.ok(lock);
    assert.equal(sleeps, 2);
    assert.match(readFileSync(lockPath, "utf8"), /"pid"/);
    lock.release();
    assert.equal(existsSync(lockPath), false);
  });
});

describe("check", () => {
  test("report lists every condition and the method", () => {
    const out = report(ctx(fakeClient(facts({ threads: ["u1"] }))), "9");
    assert.equal(out.ready, false);
    assert.equal(out.outcome, "blocked");
    assert.equal(out.method.method, "squash");
    assert.equal(out.repo, "o/r");
    assert.equal(out.conditions.length, 8);
  });

  test("--wait polls until checks finish", async () => {
    const data = facts({ checks: [{ name: "test", bucket: "pending" }] });
    const client = fakeClient(data);
    const c = ctx(client, {
      io: {
        sleep: async () => {
          data.checks = [{ name: "test", bucket: "pass" }];
        }
      }
    });
    const out = await waitForChecks(c, "9", { timeoutMinutes: 5, pollSeconds: 1 });
    assert.equal(out.outcome, "ready");
    assert.equal(out.polls, 2);
  });

  test("--wait times out while checks stay pending", async () => {
    const client = fakeClient(facts({ checks: [{ name: "test", bucket: "pending" }] }));
    const out = await waitForChecks(ctx(client), "9", { timeoutMinutes: 0, pollSeconds: 1 });
    assert.equal(out.outcome, "pending");
    assert.equal(out.timed_out, true);
  });
});

describe("CLI", () => {
  test("check and merge through the command line with a fake gh", () => {
    const fakeGh = join(tmp, "gh.cjs");
    const log = join(tmp, "gh.log");
    writeFileSync(
      fakeGh,
      `const fs = require("node:fs");
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(log)}, a.split("\\n")[0] + "\\n");
if (a.startsWith("pr view")) console.log(JSON.stringify({ number: 9, url: "${URL}", state: "OPEN", isDraft: false, headRefOid: "${HEAD}", headRefName: "feature/x", baseRefName: "main", isCrossRepository: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "", latestReviews: [], autoMergeRequest: null }));
else if (a.startsWith("pr checks") && a.includes("--required")) { console.error("no required checks reported on the 'feature/x' branch"); process.exit(1); }
else if (a.startsWith("pr checks")) console.log(JSON.stringify([{ name: "test", state: "SUCCESS", bucket: "pass", link: "", workflow: "ci" }]));
else if (a.startsWith("api graphql") && a.includes("reviewThreads")) console.log("");
else if (a.startsWith("api graphql") && a.includes("branchProtectionRule")) console.log("null");
else if (a.startsWith("api graphql")) console.log(JSON.stringify({ squashMergeAllowed: false, rebaseMergeAllowed: true, mergeCommitAllowed: true, deleteBranchOnMerge: true, pullRequest: { isMergeQueueEnabled: false, isInMergeQueue: false } }));
else if (a.includes("/rules/branches/")) console.log(JSON.stringify({ type: "required_linear_history", parameters: null }));
else if (a.includes("/compare/")) console.log(JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0 }));
else if (a.startsWith("pr merge")) console.log("merged");
else { console.error("unexpected: " + a); process.exit(1); }
`
    );
    const ghEnv = { ESP_GH_CMD: JSON.stringify([process.execPath, fakeGh]) };
    const check = cli(SCRIPT, ["check", "9", "--project-dir", tmp], ghEnv);
    assert.equal(check.code, 0, check.stderr);
    assert.equal(check.json().ready, true);
    assert.equal(check.json().method.method, "rebase");
    assert.equal(check.json().policy.linear_history, true);

    const merged = cli(SCRIPT, ["merge", "9", "--run-dir", runDir, "--project-dir", tmp], ghEnv);
    assert.equal(merged.code, 0, merged.stderr);
    const block = JSON.parse(merged.stdout.trim().split("\n").at(-1));
    assert.equal(block.status, "merged");
    assert.equal(block.outputs.method, "rebase");
    assert.match(readFileSync(log, "utf8"), new RegExp(`pr merge 9 --rebase --match-head-commit ${HEAD}`));

    const usage = cli(SCRIPT, ["merge", "--method", "fast"], ghEnv);
    assert.equal(usage.code, 2);
  });

  test("run without a command prints usage with exit 2", async () => {
    const out = await run([], env());
    assert.equal(out.exitCode, 2);
  });
});
