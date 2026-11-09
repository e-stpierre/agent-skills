import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../lib/contract.mjs";
import {
  buildContext,
  buildResult,
  cmdChecks,
  cmdFetch,
  cmdInternal,
  cmdRecord,
  cmdRespond,
  cmdResult,
  cmdRound,
  collectItems,
  excerpt,
  FixReviewError,
  githubActions,
  latestFindings,
  quoteReply,
  summarizeChecks
} from "../fix-review.mjs";
import { validateFile } from "../runs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "fix-review.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-08T12:00:00.000Z";
const HEAD = "c".repeat(40);
const URL = "https://github.com/o/r/pull/7";

function prData() {
  return {
    inline: [
      { id: 101, node_id: "PRRC_1", login: "chatgpt-codex-connector[bot]", user_type: "Bot", body: "Off by one in loop", path: "src/a.js", line: 4, created_at: "2026-11-08T10:01:00Z", html_url: `${URL}#discussion_r101` },
      { id: 102, node_id: "PRRC_2", login: "me", user_type: "User", body: "Fixed", path: "src/a.js", line: 4, in_reply_to_id: 101, created_at: "2026-11-08T10:05:00Z", html_url: `${URL}#discussion_r102` },
      { id: 103, node_id: "PRRC_3", login: "alice", user_type: "User", body: "Rename this", path: "src/b.js", line: 9, created_at: "2026-11-08T10:02:00Z", html_url: `${URL}#discussion_r103` },
      { id: 104, node_id: "PRRC_4", login: "claude[bot]", user_type: "Bot", body: "Old thread", path: "src/c.js", line: 1, created_at: "2026-11-08T09:00:00Z", html_url: `${URL}#discussion_r104` }
    ],
    reviews: [
      { id: 201, node_id: "PRR_1", login: "chatgpt-codex-connector[bot]", user_type: "Bot", body: "Codex review summary", state: "COMMENTED", commit_id: HEAD, submitted_at: "2026-11-08T10:00:00Z", html_url: `${URL}#pullrequestreview-201` },
      { id: 202, node_id: "PRR_2", login: "alice", user_type: "User", body: "", state: "APPROVED", submitted_at: "2026-11-08T10:03:00Z" }
    ],
    comments: [
      { id: 301, node_id: "IC_1", login: "claude[bot]", user_type: "Bot", body: "<!-- marker -->\n# Pull Request Review\nMissing test for divide", created_at: "2026-11-08T10:04:00Z", html_url: `${URL}#issuecomment-301` }
    ],
    threads: [
      { id: "PRRT_1", isResolved: false, isOutdated: false, comments: [101, 102] },
      { id: "PRRT_2", isResolved: false, isOutdated: true, comments: [103] },
      { id: "PRRT_3", isResolved: true, isOutdated: false, comments: [104] }
    ]
  };
}

function fakeClient(data = prData(), { checks = [] } = {}) {
  const calls = { replyInline: [], comment: [], resolveThread: [], minimize: [] };
  return {
    calls,
    pr: () => ({ number: 7, url: URL, state: "OPEN", head: HEAD, branch: "feature/x", base: "main", draft: false }),
    user: () => "me",
    inlineComments: () => data.inline,
    reviews: () => data.reviews,
    issueComments: () => data.comments,
    threads: () => data.threads,
    checks: () => checks,
    replyInline: (repo, number, id, body) => {
      calls.replyInline.push({ repo, number, id, body });
      return `${URL}#discussion_r9${id}`;
    },
    comment: (repo, number, body) => {
      calls.comment.push({ repo, number, body });
      return `${URL}#issuecomment-999`;
    },
    resolveThread: (id) => calls.resolveThread.push(id),
    minimize: (id) => calls.minimize.push(id)
  };
}

let tmp;
let home;
let runDir;
const env = () => ({ ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW });

function cli(script, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...env(), ...extraEnv } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

function ctx(options = {}, client = fakeClient()) {
  return buildContext({ "run-dir": runDir, "project-dir": tmp, ...options }, env(), { client });
}

const decisions = () =>
  readFileSync(join(runDir, "decisions.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const state = () => JSON.parse(readFileSync(join(runDir, "fix-review.json"), "utf8"));

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-fix-review-"));
  home = join(tmp, "home");
  mkdirSync(home);
  const created = cli(RUNS, ["create", "toy", "--root", join(tmp, "runs"), "--project-dir", tmp]);
  assert.equal(created.code, 0, created.stderr);
  runDir = created.json().run_dir;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("collectItems", () => {
  test("skips own comments, resolved threads and empty reviews, and links threads", () => {
    const { items, skipped } = collectItems(prData(), { ownLogin: "me" });
    assert.deepEqual(
      items.map((i) => i.id),
      ["review:201", "inline:101", "inline:103", "comment:301"]
    );
    assert.deepEqual(skipped, { handled: 0, own: 1, resolved: 1, filtered: 0 });
    const inline = items.find((i) => i.id === "inline:101");
    assert.equal(inline.thread_id, "PRRT_1");
    assert.equal(inline.bot, true);
    assert.equal(items.find((i) => i.id === "inline:103").outdated, true);
  });

  test("filters by reviewer name or login, with or without [bot]", () => {
    const reviewers = [{ name: "codex", login: "chatgpt-codex-connector[bot]" }];
    const { items, skipped, authors } = collectItems(prData(), { ownLogin: "me", reviewers });
    assert.deepEqual(
      items.map((i) => i.id),
      ["review:201", "inline:101"]
    );
    assert.equal(skipped.filtered, 3);
    assert.deepEqual(authors, ["chatgpt-codex-connector[bot]"]);
    const raw = collectItems(prData(), { reviewers: [{ name: "alice", login: "alice" }] });
    assert.deepEqual(
      raw.items.map((i) => i.id),
      ["inline:103"]
    );
  });

  test("handled items are skipped unless includeHandled", () => {
    const handled = { "inline:101": { resolution: "fixed" } };
    assert.equal(collectItems(prData(), { ownLogin: "me", handled }).skipped.handled, 1);
    assert.equal(collectItems(prData(), { ownLogin: "me", handled, includeHandled: true }).items.length, 4);
  });
});

describe("githubActions", () => {
  const inline = { kind: "inline", thread_id: "T", bot: true };
  const human = { kind: "inline", thread_id: "T", bot: false };
  const comment = { kind: "comment", node_id: "IC", bot: true };

  test("fixed resolves threads and minimizes bot comments, without a reply", () => {
    assert.deepEqual(githubActions(inline, "fixed"), { reply: false, resolve: true, minimize: false });
    assert.deepEqual(githubActions(comment, "fixed"), { reply: false, resolve: false, minimize: true });
    assert.deepEqual(githubActions({ ...comment, bot: false }, "fixed"), { reply: false, resolve: false, minimize: false });
  });

  test("rejected replies when allowed and resolves only bot threads", () => {
    assert.deepEqual(githubActions(inline, "rejected", { reply: "Already handled" }), { reply: true, resolve: true, minimize: false });
    assert.deepEqual(githubActions(human, "rejected", { reply: "Already handled" }), { reply: true, resolve: false, minimize: false });
    assert.equal(githubActions(inline, "rejected", { reply: "x", replyToRejected: false }).reply, false);
  });

  test("deferred resolves in follow-up mode and leaves the thread open in block mode", () => {
    assert.equal(githubActions(inline, "deferred", { reply: "Follow-up" }).resolve, true);
    assert.equal(githubActions(inline, "deferred", { reply: "Follow-up", deferredItems: "block" }).resolve, false);
    assert.deepEqual(githubActions(inline, "open", { reply: "Which one?" }), { reply: true, resolve: false, minimize: false });
  });

  test("findings and checks owe nothing on GitHub", () => {
    assert.deepEqual(githubActions({ kind: "finding" }, "fixed", { reply: "x" }), { reply: false, resolve: false, minimize: false });
    assert.deepEqual(githubActions({ kind: "check" }, "fixed"), { reply: false, resolve: false, minimize: false });
  });
});

describe("fetch, record and rounds", () => {
  test("a second fetch never returns a handled comment", () => {
    const first = cmdFetch(ctx(), null);
    assert.equal(first.pr, 7);
    assert.equal(first.items.length, 4);
    cmdRecord(ctx(), {
      items: ["inline:101"],
      resolution: "fixed",
      class: "A-Fix",
      decision: "Fixed the loop bound",
      rationale: "the loop skipped the last element",
      commit: "abc1234",
      files: ["src/a.js"]
    });
    const second = cmdFetch(ctx(), null);
    assert.deepEqual(
      second.items.map((i) => i.id),
      ["review:201", "inline:103", "comment:301"]
    );
    assert.equal(second.skipped.handled, 1);
    assert.deepEqual(second.pending_github, ["inline:101"]);
  });

  test("record logs a contract decision with the class, refs and commit", () => {
    cmdFetch(ctx(), null);
    const out = cmdRecord(ctx(), {
      items: ["inline:103"],
      resolution: "rejected",
      class: "Reject",
      decision: "Kept the name",
      rationale: "the name matches AGENTS.md",
      reply: "Kept: the name follows AGENTS.md."
    });
    assert.equal(out.decision_id, "D001");
    const [d] = decisions();
    assert.equal(d.phase, "fix-review");
    assert.equal(d.source, "agent");
    assert.equal(d.risk, "low");
    assert.equal(d["x-esp-class"], "Reject");
    assert.equal(d.rationale, "Reject: the name matches AGENTS.md");
    assert.deepEqual(d.refs, [`${URL}#discussion_r103`]);
    assert.equal(validateFile(join(runDir, "decisions.jsonl")).valid, true);
    assert.equal(state().handled["inline:103"].github.reply, true);
  });

  test("deferrals are policy decisions; invalid class and resolution pairs fail", () => {
    cmdFetch(ctx(), null);
    cmdRecord(ctx(), {
      items: ["comment:301"],
      resolution: "deferred",
      class: "B-Scope",
      decision: "Deferred the divide test",
      rationale: "adds a new behavior",
      discovered_item: { type: "test", title: "Test divide by zero", severity: "medium" }
    });
    assert.equal(decisions()[0].source, "policy");
    assert.equal(decisions()[0].risk, "medium");
    assert.throws(
      () => cmdRecord(ctx(), { items: ["inline:101"], resolution: "fixed", class: "B-Scope", decision: "x", rationale: "y" }),
      (err) => err instanceof FixReviewError && err.exitCode === 2
    );
    assert.throws(
      () => cmdRecord(ctx(), { items: ["inline:999"], resolution: "fixed", class: "A-Fix", decision: "x", rationale: "y" }),
      /unknown item/
    );
  });

  test("a fixed B-Decide item defaults to medium risk", () => {
    cmdFetch(ctx(), null);
    const out = cmdRecord(ctx(), { items: ["inline:103"], resolution: "fixed", class: "B-Decide", decision: "Renamed", rationale: "best fit", alternatives: ["keep"] });
    assert.equal(out.risk, "medium");
    assert.deepEqual(decisions()[0].alternatives, ["keep"]);
  });

  test("round counts persist and stop at max rounds", () => {
    const c = ctx({ "max-rounds": "2" });
    assert.deepEqual(cmdRound(c), { round: 1, exhausted: false, rounds: 1, max_rounds: 2, last: false });
    assert.equal(cmdRound(ctx({ "max-rounds": "2" })).last, true);
    assert.deepEqual(cmdRound(ctx({ "max-rounds": "2" })), { round: null, exhausted: true, rounds: 2, max_rounds: 2 });
  });

  test("the default round limit comes from fix-review.max_rounds", () => {
    assert.equal(ctx().maxRounds, 3);
    writeFileSync(join(home, "config.json"), JSON.stringify({ "fix-review": { max_rounds: 1 } }));
    assert.equal(ctx().maxRounds, 1);
  });

  test("a state file is bound to one pull request", () => {
    cmdFetch(ctx(), null);
    const other = fakeClient();
    other.pr = () => ({ number: 8, url: "https://github.com/o/r/pull/8", head: HEAD });
    assert.throws(() => cmdFetch(ctx({}, other), null), /belongs to pull request 7/);
  });
});

describe("respond", () => {
  test("posts owed replies once, resolves threads and minimizes bot comments", () => {
    const client = fakeClient();
    cmdFetch(ctx({}, client), null);
    cmdRecord(ctx({}, client), { items: ["inline:101"], resolution: "fixed", class: "A-Fix", decision: "Fixed", rationale: "clear" });
    cmdRecord(ctx({}, client), { items: ["comment:301"], resolution: "fixed", class: "A-Fix", decision: "Added test", rationale: "clear" });
    cmdRecord(ctx({}, client), {
      items: ["review:201"],
      resolution: "rejected",
      class: "Reject",
      decision: "Not applicable",
      rationale: "outdated",
      reply: "Outdated: the code moved to src/b.js in item 2."
    });
    const out = cmdRespond(ctx({}, client));
    assert.equal(out.failed.length, 0);
    assert.equal(out.responded.length, 3);
    assert.deepEqual(client.calls.resolveThread, ["PRRT_1"]);
    assert.deepEqual(client.calls.minimize, ["IC_1"]);
    assert.equal(client.calls.replyInline.length, 0);
    assert.equal(client.calls.comment.length, 1);
    assert.match(client.calls.comment[0].body, /^> Codex review summary\n\n\(re: .*pullrequestreview-201\)\n\nOutdated/);
    const again = cmdRespond(ctx({}, client));
    assert.equal(again.responded.length, 0);
    assert.equal(client.calls.comment.length, 1);
  });

  test("inline replies go to the thread root, and failures stay pending", () => {
    const client = fakeClient();
    cmdFetch(ctx({}, client), null);
    cmdRecord(ctx({}, client), { items: ["inline:103"], resolution: "open", class: "B-Decide", decision: "Ask which name", rationale: "two names fit", reply: "Which name?" });
    client.replyInline = () => {
      throw new FixReviewError("HTTP 502");
    };
    const failed = cmdRespond(ctx({}, client));
    assert.equal(failed.failed.length, 1);
    assert.equal(state().handled["inline:103"].github.done, false);
    const ok = fakeClient();
    const out = cmdRespond(ctx({}, ok));
    assert.equal(out.responded.length, 1);
    assert.equal(ok.calls.replyInline[0].id, 103);
    assert.equal(ok.calls.resolveThread.length, 0);
  });
});

describe("internal mode", () => {
  function writeFindings(n) {
    const findings = {
      review_format: 1,
      base: "a".repeat(40),
      head: "b".repeat(40),
      min_severity: "medium",
      verified: true,
      findings: [
        { id: "F1", severity: "high", dimension: "correctness", class: "A", location: "src/a.js:4", title: "Off by one", evidence: "i < n - 1", fix: "use i < n", options: [], recommended: null, decision: null, body: "" },
        { id: "F2", severity: "medium", dimension: "tests", class: "B-Decide", location: "src/a.js:9", title: "No zero test", evidence: "", fix: "", options: ["throw", "Infinity"], recommended: "throw", decision: null, body: "" }
      ],
      rejected: []
    };
    writeFileSync(join(runDir, `review-${n}.json`), JSON.stringify(findings));
  }

  test("loads the latest review findings and skips handled ones", () => {
    writeFindings(1);
    writeFindings(2);
    assert.equal(latestFindings(runDir), join(runDir, "review-2.json"));
    const out = cmdInternal(ctx(), undefined);
    assert.equal(out.mode, "internal");
    assert.deepEqual(
      out.items.map((i) => i.id),
      ["finding:review-2:F1", "finding:review-2:F2"]
    );
    assert.equal(out.items[1].recommended, "throw");
    cmdRecord(ctx(), { items: ["finding:review-2:F1"], resolution: "fixed", class: "A-Fix", decision: "Fixed bound", rationale: "clear", commit: "abc1234" });
    const again = cmdInternal(ctx(), undefined);
    assert.equal(again.items.length, 1);
    assert.equal(again.skipped.handled, 1);
  });

  test("rejects a non-findings file and a pull request state", () => {
    writeFileSync(join(runDir, "x.json"), "{}");
    assert.throws(() => cmdInternal(ctx(), join(runDir, "x.json")), /review_format 1/);
    cmdFetch(ctx(), null);
    writeFindings(1);
    assert.throws(() => cmdInternal(ctx(), undefined), /pull request fix-review/);
  });
});

describe("checks", () => {
  test("summarizes buckets and keys failing checks by head", () => {
    const summary = summarizeChecks(
      [
        { name: "lint", bucket: "fail", state: "FAILURE", link: "l1", workflow: "CI" },
        { name: "test", bucket: "pass", state: "SUCCESS" },
        { name: "build", bucket: "pending", state: "IN_PROGRESS" },
        { name: "deploy", bucket: "skipping", state: "SKIPPED" }
      ],
      HEAD
    );
    assert.equal(summary.passing, 1);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(
      summary.failing.map((c) => c.id),
      [`check:lint@${HEAD.slice(0, 7)}`]
    );
    assert.equal(summary.pending.length, 1);
  });

  test("failing checks become recordable items", () => {
    const client = fakeClient(prData(), { checks: [{ name: "lint", bucket: "fail", state: "FAILURE" }] });
    cmdFetch(ctx({}, client), null);
    const out = cmdChecks(ctx({}, client), null);
    const id = out.failing[0].id;
    cmdRecord(ctx({}, client), { items: [id], resolution: "fixed", class: "A-Fix", decision: "Ran the formatter", rationale: "prettier violations", commit: "def5678" });
    assert.equal(cmdChecks(ctx({}, client), null).failing[0].handled, true);
    const block = cmdResult(ctx({}, client), {});
    assert.equal(block.outputs.ci_fixed, 1);
    assert.equal(block.outputs.fixed, 0);
  });
});

describe("result", () => {
  function handledState(handled, extra = {}) {
    return {
      state_format: 1,
      mode: "pr",
      pr: 7,
      url: URL,
      repo: "o/r",
      head: HEAD,
      max_rounds: 2,
      rounds: [{ n: 1 }],
      items: {},
      handled,
      ...extra
    };
  }

  test("done with deferred items as discovered_items and max risk", () => {
    const block = buildResult(
      handledState({
        "inline:1": { resolution: "fixed", risk: "low", commit: "abc1234", decision: "Fixed" },
        "inline:2": { resolution: "deferred", risk: "medium", decision: "Defer API rename", discovered_item: { type: "follow-up", title: "Rename getUser" } },
        "comment:3": { resolution: "rejected", risk: "low", decision: "Wrong" }
      })
    );
    assert.equal(block.status, "done");
    assert.equal(block.max_risk, "medium");
    assert.equal(block.commit, "abc1234");
    assert.equal(block.pr, URL);
    assert.deepEqual(block.discovered_items, [{ type: "follow-up", title: "Rename getUser", evidence: "inline:2" }]);
    assert.equal(block.outputs.fixed, 1);
    assert.equal(block.outputs.rejected, 1);
    assert.equal(validateArtifact("result", block).valid, true);
  });

  test("open items end awaiting-human, with a blocking needs_input under a run", () => {
    const s = handledState({ "inline:1": { resolution: "open", risk: "high", decision: "Pick a name" } });
    assert.equal(buildResult(s).needs_input, undefined);
    const block = buildResult(s, { runDir: "/x" });
    assert.equal(block.status, "awaiting-human");
    assert.equal(block.needs_input.blocking, true);
    assert.equal(validateArtifact("result", block).valid, true);
  });

  test("exhausted rounds with items left halt on budget, else add a follow-up", () => {
    const s = handledState({}, { rounds: [{ n: 1 }, { n: 2 }] });
    const halted = buildResult(s, { remaining: 2, haltOn: ["budget"] });
    assert.equal(halted.status, "halted");
    assert.equal(halted.max_risk, "high");
    const done = buildResult(s, { remaining: 2, haltOn: [] });
    assert.equal(done.status, "done");
    assert.match(done.discovered_items[0].title, /2 review items left after 2 fix rounds/);
    assert.equal(buildResult(handledState({}), { remaining: 2, haltOn: ["budget"] }).status, "done");
  });

  test("cmdResult logs the budget halt as a policy decision", () => {
    cmdFetch(ctx(), null);
    cmdRound(ctx({ "max-rounds": "1" }));
    const block = cmdResult(ctx({ "max-rounds": "1" }), { remaining: "1" });
    assert.equal(block.status, "halted");
    const [d] = decisions();
    assert.equal(d.source, "policy");
    assert.equal(d["x-esp-class"], "Halt");
    assert.match(d.rationale, /^Halt: budget/);
  });
});

describe("helpers", () => {
  test("excerpt skips HTML comments and blank lines", () => {
    assert.equal(excerpt("<!-- x -->\n\n  First line  \nSecond"), "First line");
    assert.equal(excerpt(""), null);
  });

  test("quoteReply quotes the excerpt and links the original", () => {
    assert.equal(quoteReply({ excerpt: "Do X", url: "u" }, "No."), "> Do X\n\n(re: u)\n\nNo.");
  });
});

describe("CLI", () => {
  test("round, record and result through the command line", () => {
    const fakeGh = join(tmp, "gh.mjs");
    writeFileSync(
      fakeGh,
      `const a = process.argv.slice(2).join(" ");
if (a.startsWith("pr view")) console.log(JSON.stringify({ number: 7, url: "${URL}", state: "OPEN", headRefOid: "${HEAD}", headRefName: "x", baseRefName: "main", isDraft: false }));
else if (a.startsWith("api user")) console.log("me");
else if (a.includes("pulls/7/comments")) console.log(JSON.stringify({ id: 101, node_id: "N", login: "claude[bot]", user_type: "Bot", body: "Bug", path: "a.js", line: 1, created_at: "2026-11-08T10:00:00Z", html_url: "${URL}#r101" }));
else if (a.startsWith("api graphql")) console.log(JSON.stringify({ id: "T1", isResolved: false, isOutdated: false, comments: [101] }));
else console.log("");
`
    );
    const ghEnv = { ESP_GH_CMD: JSON.stringify([process.execPath, fakeGh]) };
    const round = cli(SCRIPT, ["round", "--run-dir", runDir], ghEnv);
    assert.equal(round.code, 0, round.stderr);
    assert.equal(round.json().round, 1);
    const fetched = cli(SCRIPT, ["fetch", "7", "--run-dir", runDir, "--reviewers", "claude"], ghEnv);
    assert.equal(fetched.code, 0, fetched.stderr);
    assert.deepEqual(fetched.json().reviewers_seen, ["claude"]);
    assert.equal(fetched.json().items[0].thread_id, "T1");
    const recorded = cli(SCRIPT, [
      "record",
      "--run-dir",
      runDir,
      "--json",
      JSON.stringify({ items: ["inline:101"], resolution: "fixed", class: "A-Fix", decision: "Fixed", rationale: "clear", commit: "abc1234" })
    ]);
    assert.equal(recorded.code, 0, recorded.stderr);
    const result = cli(SCRIPT, ["result", "--run-dir", runDir]);
    assert.equal(result.code, 0, result.stderr);
    const block = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(block.status, "done");
    assert.equal(block.outputs.fixed, 1);
    assert.equal(block.outputs.pending_github, 1);
    const usage = cli(SCRIPT, ["record", "--run-dir", runDir, "--json", "{}"]);
    assert.equal(usage.code, 2);
  });
});
