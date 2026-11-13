import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../lib/contract.mjs";
import {
  checksStatus,
  codexState,
  nextInterval,
  prArgument,
  resolveReviewers,
  reviewerStatus,
  sameLogin,
  triggerPosted,
  waitForReview,
  WaitError
} from "../wait-for-review.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "wait-for-review.mjs");
const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const HEAD_DATE = "2026-11-08T10:00:00Z";

const CONFIGURED = {
  claude: { login: "claude[bot]", trigger: null },
  codex: { login: "chatgpt-codex-connector[bot]", trigger: "@codex review" }
};

function codexSummary(sha, status) {
  return `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","has_any_findings":false,"status":"${status}"},"security_review":{"commit_sha":null,"status":null}} -->\n\n<details>Codex Review Summary</details>`;
}

/**
 * A scripted fake GitHub client. `steps` is a list of per-poll snapshots:
 * `{ head, state, reviews, comments }`; the last one repeats.
 */
function fakeClient(steps, { failures = 0 } = {}) {
  let poll = -1;
  let toFail = failures;
  const calls = { comment: [], pr: 0 };
  const current = () => steps[Math.min(poll, steps.length - 1)];
  return {
    calls,
    pr() {
      if (toFail > 0) {
        toFail -= 1;
        throw new WaitError("gh pr view failed: HTTP 502");
      }
      poll += 1;
      calls.pr += 1;
      const step = current();
      return {
        number: 7,
        url: "https://github.com/o/r/pull/7",
        state: step.state ?? "OPEN",
        head: step.head ?? HEAD,
        draft: false
      };
    },
    commitDate() {
      return current().headDate ?? HEAD_DATE;
    },
    reviews() {
      return current().reviews ?? [];
    },
    comments() {
      return current().comments ?? [];
    },
    comment(number, body) {
      calls.comment.push({ number, body });
    },
    checks() {
      return current().checks ?? [];
    }
  };
}

function fakeClock(start = "2026-11-08T10:05:00Z") {
  let t = Date.parse(start);
  const sleeps = [];
  return {
    sleeps,
    now: () => new Date(t),
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    }
  };
}

function baseOptions(extra = {}) {
  return {
    pr: "7",
    reviewers: resolveReviewers(["codex"], CONFIGURED),
    timeoutMinutes: 30,
    pollSeconds: 60,
    maxPollSeconds: 300,
    backoff: 1.5,
    trigger: false,
    once: false,
    statePath: null,
    runDir: null,
    ...extra
  };
}

const codexReview = (commit_id, extra = {}) => ({
  id: 1,
  login: "chatgpt-codex-connector[bot]",
  commit_id,
  state: "COMMENTED",
  submitted_at: "2026-11-08T10:10:00Z",
  html_url: "https://github.com/o/r/pull/7#pullrequestreview-1",
  ...extra
});

describe("helpers", () => {
  test("sameLogin ignores case and the [bot] suffix", () => {
    assert.ok(sameLogin("claude[bot]", "Claude"));
    assert.ok(
      sameLogin("chatgpt-codex-connector", "chatgpt-codex-connector[bot]")
    );
    assert.ok(!sameLogin("claude[bot]", "claude-dev[bot]"));
    assert.ok(!sameLogin("", ""));
  });

  test("resolveReviewers maps names to logins and keeps raw logins", () => {
    assert.deepEqual(resolveReviewers("codex, my-bot[bot],codex", CONFIGURED), [
      {
        name: "codex",
        login: "chatgpt-codex-connector[bot]",
        trigger: "@codex review"
      },
      { name: "my-bot[bot]", login: "my-bot[bot]", trigger: null }
    ]);
    assert.throws(
      () => resolveReviewers([], CONFIGURED),
      (err) => err.exitCode === 2
    );
  });

  test("prArgument accepts numbers, #n, PR n and URLs", () => {
    assert.equal(prArgument("12"), "12");
    assert.equal(prArgument("#12"), "12");
    assert.equal(prArgument("PR 12"), "12");
    assert.equal(
      prArgument("https://github.com/o/r/pull/12"),
      "https://github.com/o/r/pull/12"
    );
    assert.equal(prArgument(""), null);
    assert.throws(
      () => prArgument("feature/x"),
      (err) => err.exitCode === 2
    );
  });

  test("nextInterval backs off and caps", () => {
    assert.equal(nextInterval(60, 1.5, 0, 300), 60);
    assert.equal(nextInterval(60, 1.5, 1, 300), 90);
    assert.equal(nextInterval(60, 1.5, 2, 300), 135);
    assert.equal(nextInterval(60, 1.5, 10, 300), 300);
  });

  test("codexState parses the review state marker", () => {
    assert.deepEqual(codexState(codexSummary(HEAD, "completed")), {
      commit_sha: HEAD,
      status: "completed"
    });
    assert.equal(codexState("plain comment"), null);
    assert.equal(codexState("<!-- codex-review-state:v1 {broken -->"), null);
  });
});

describe("reviewerStatus", () => {
  const codex = resolveReviewers(["codex"], CONFIGURED)[0];
  const claude = resolveReviewers(["claude"], CONFIGURED)[0];

  test("a review on the head SHA completes the reviewer", () => {
    const status = reviewerStatus(codex, {
      head: HEAD,
      headDate: HEAD_DATE,
      reviews: [codexReview(HEAD)]
    });
    assert.equal(status.status, "reviewed");
    assert.equal(status.kind, "review");
    assert.equal(status.stale, 0);
  });

  test("a review on another SHA is stale, not a completion", () => {
    const status = reviewerStatus(codex, {
      head: HEAD,
      headDate: HEAD_DATE,
      reviews: [codexReview(OLD)]
    });
    assert.equal(status.status, "pending");
    assert.equal(status.stale, 1);
  });

  test("a review by another login does not count", () => {
    const review = codexReview(HEAD, { login: "someone" });
    assert.equal(
      reviewerStatus(codex, { head: HEAD, reviews: [review] }).status,
      "pending"
    );
  });

  test("a Codex summary comment completes only for the head SHA", () => {
    const comment = (sha, status) => ({
      id: 9,
      login: "chatgpt-codex-connector[bot]",
      body: codexSummary(sha, status),
      created_at: "2026-11-08T09:00:00Z",
      updated_at: "2026-11-08T10:20:00Z"
    });
    assert.equal(
      reviewerStatus(codex, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment(HEAD, "completed")]
      }).status,
      "reviewed"
    );
    assert.equal(
      reviewerStatus(codex, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment(HEAD, "in_progress")]
      }).status,
      "in-progress"
    );
    assert.equal(
      reviewerStatus(codex, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment(OLD, "completed")]
      }).status,
      "pending"
    );
  });

  test("a plain comment after the head commit completes, a progress placeholder does not", () => {
    const comment = (body, at) => ({
      id: 3,
      login: "claude[bot]",
      body,
      created_at: at,
      updated_at: at
    });
    const after = "2026-11-08T10:30:00Z";
    const before = "2026-11-08T09:30:00Z";
    assert.equal(
      reviewerStatus(claude, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment("# Review\nLooks fine.", after)]
      }).status,
      "reviewed"
    );
    assert.equal(
      reviewerStatus(claude, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment("# Review\nOld.", before)]
      }).status,
      "pending"
    );
    assert.equal(
      reviewerStatus(claude, {
        head: HEAD,
        headDate: HEAD_DATE,
        comments: [comment("Claude is working on it", after)]
      }).status,
      "in-progress"
    );
  });

  test("triggerPosted only sees trigger comments on the current head", () => {
    const comment = (at) => ({
      login: "me",
      body: "@codex review please",
      created_at: at
    });
    assert.ok(
      triggerPosted("@codex review", {
        headDate: HEAD_DATE,
        comments: [comment("2026-11-08T10:01:00Z")]
      })
    );
    assert.ok(
      !triggerPosted("@codex review", {
        headDate: HEAD_DATE,
        comments: [comment("2026-11-08T09:59:00Z")]
      })
    );
    assert.ok(!triggerPosted(null, { comments: [] }));
  });
});

describe("waitForReview", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "esp-wait-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("waits until the reviewer reviews the head, with backoff", async () => {
    const client = fakeClient([{}, {}, {}, { reviews: [codexReview(HEAD)] }]);
    const clock = fakeClock();
    const statePath = join(dir, "fix-review-wait.json");
    const { result } = await waitForReview(baseOptions({ statePath }), {
      client,
      ...clock
    });
    assert.equal(result.status, "done");
    assert.deepEqual(validateArtifact("result", result).errors, []);
    assert.deepEqual(clock.sleeps, [60_000, 90_000, 135_000]);
    assert.deepEqual(result.outputs.completed, ["codex"]);
    assert.equal(result.outputs.polls, 4);
    assert.equal(result.outputs.head, HEAD);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.status, "done");
    assert.ok(state.ended_at);
  });

  test("head SHA mismatch: an old review does not count, and a new head resets the wait", async () => {
    const client = fakeClient([
      { head: OLD, reviews: [] },
      { head: OLD, reviews: [] },
      { head: HEAD, reviews: [codexReview(OLD)] },
      { head: HEAD, reviews: [codexReview(OLD), codexReview(HEAD, { id: 2 })] }
    ]);
    const clock = fakeClock();
    const lines = [];
    const { result, state } = await waitForReview(baseOptions(), {
      client,
      ...clock,
      log: (l) => lines.push(l)
    });
    assert.equal(result.status, "done");
    assert.equal(result.outputs.head, HEAD);
    assert.deepEqual(state.heads, [OLD, HEAD]);
    assert.ok(lines.some((l) => l.startsWith("head changed")));
    // The backoff restarts on the new head.
    assert.deepEqual(clock.sleeps, [60_000, 90_000, 60_000]);
  });

  test("times out to awaiting-human with a needs_input request", async () => {
    const client = fakeClient([{ reviews: [codexReview(OLD)] }]);
    const clock = fakeClock();
    const { result } = await waitForReview(baseOptions({ timeoutMinutes: 5 }), {
      client,
      ...clock
    });
    assert.equal(result.status, "awaiting-human");
    assert.match(result.summary, /Timed out after 5 min/);
    assert.equal(result.needs_input.recommended, "wait");
    assert.deepEqual(validateArtifact("result", result).errors, []);
    assert.deepEqual(result.outputs.pending, ["codex"]);
    const waited = clock.sleeps.reduce((a, b) => a + b, 0);
    assert.equal(waited, 5 * 60_000);
  });

  test("multiple reviewers: done only when every reviewer reviewed the head", async () => {
    const claudeComment = {
      id: 4,
      login: "claude[bot]",
      body: "# Review\nNo issues.",
      created_at: "2026-11-08T10:30:00Z"
    };
    const client = fakeClient([
      { reviews: [codexReview(HEAD)] },
      { reviews: [codexReview(HEAD)] },
      { reviews: [codexReview(HEAD)], comments: [claudeComment] }
    ]);
    const clock = fakeClock();
    const reviewers = resolveReviewers(["codex", "claude"], CONFIGURED);
    const { result } = await waitForReview(baseOptions({ reviewers }), {
      client,
      ...clock
    });
    assert.equal(result.status, "done");
    assert.deepEqual(result.outputs.completed, ["codex", "claude"]);
    assert.deepEqual(result.outputs.reviewers, {
      codex: "reviewed",
      claude: "reviewed"
    });
    assert.equal(clock.sleeps.length, 2);
  });

  test("multiple reviewers: a timeout lists only the missing ones", async () => {
    const client = fakeClient([{ reviews: [codexReview(HEAD)] }]);
    const reviewers = resolveReviewers(["codex", "claude"], CONFIGURED);
    const { result } = await waitForReview(
      baseOptions({ reviewers, timeoutMinutes: 2 }),
      { client, ...fakeClock() }
    );
    assert.equal(result.status, "awaiting-human");
    assert.deepEqual(result.outputs.completed, ["codex"]);
    assert.deepEqual(result.outputs.pending, ["claude"]);
    assert.match(result.needs_input.question, /claude/);
  });

  test("posts the trigger once per head, never on the first poll", async () => {
    const client = fakeClient([{}, {}, {}, { reviews: [codexReview(HEAD)] }]);
    const { result } = await waitForReview(baseOptions({ trigger: true }), {
      client,
      ...fakeClock()
    });
    assert.equal(result.status, "done");
    assert.deepEqual(client.calls.comment, [
      { number: 7, body: "@codex review" }
    ]);
    assert.deepEqual(result.outputs.triggered, ["codex"]);
  });

  test("does not trigger when a trigger comment exists or the review is in progress", async () => {
    const existing = {
      id: 5,
      login: "me",
      body: "@codex review",
      created_at: "2026-11-08T10:01:00Z"
    };
    const running = {
      id: 6,
      login: "chatgpt-codex-connector[bot]",
      body: codexSummary(HEAD, "in_progress"),
      created_at: "2026-11-08T10:02:00Z"
    };
    for (const comments of [[existing], [running]]) {
      const client = fakeClient([
        { comments },
        { comments },
        { comments, reviews: [codexReview(HEAD)] }
      ]);
      await waitForReview(baseOptions({ trigger: true }), {
        client,
        ...fakeClock()
      });
      assert.deepEqual(client.calls.comment, []);
    }
  });

  test("a closed pull request fails", async () => {
    const client = fakeClient([{ state: "MERGED" }]);
    const { result } = await waitForReview(baseOptions(), {
      client,
      ...fakeClock()
    });
    assert.equal(result.status, "failed");
    assert.match(result.summary, /merged/);
  });

  test("transient gh errors are retried, persistent ones fail", async () => {
    const ok = fakeClient([{ reviews: [codexReview(HEAD)] }], { failures: 2 });
    assert.equal(
      (await waitForReview(baseOptions(), { client: ok, ...fakeClock() }))
        .result.status,
      "done"
    );
    const broken = fakeClient([{}], { failures: 99 });
    const { result } = await waitForReview(baseOptions(), {
      client: broken,
      ...fakeClock()
    });
    assert.equal(result.status, "failed");
    assert.match(result.summary, /5 time/);
  });

  test("--once checks a single time", async () => {
    const client = fakeClient([{}]);
    const clock = fakeClock();
    const { result } = await waitForReview(baseOptions({ once: true }), {
      client,
      ...clock
    });
    assert.equal(result.status, "awaiting-human");
    assert.equal(result.needs_input, undefined);
    assert.equal(clock.sleeps.length, 0);
  });

  test("an interrupted wait keeps its clock", async () => {
    const statePath = join(dir, "fix-review-wait.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        pr: 7,
        started_at: "2026-11-08T09:40:00Z",
        ended_at: null,
        triggered: []
      })
    );
    const client = fakeClient([{}]);
    const { result } = await waitForReview(
      baseOptions({ statePath, timeoutMinutes: 30 }),
      { client, ...fakeClock() }
    );
    // Started 25 minutes before the clock: 5 minutes left.
    assert.equal(result.status, "awaiting-human");
    assert.equal(result.outputs.waited_seconds, 30 * 60);
  });

  test("records review.received events in the run dir", async () => {
    const runDir = join(dir, "run");
    const runs = spawnSync(
      process.execPath,
      [
        join(HERE, "..", "runs.mjs"),
        "create",
        "wait",
        "--root",
        dir,
        "--run-dir",
        runDir,
        "--workflow",
        "esp-fix-review"
      ],
      {
        encoding: "utf8"
      }
    );
    assert.equal(runs.status, 0, runs.stderr);
    const client = fakeClient([{ reviews: [codexReview(HEAD)] }]);
    await waitForReview(
      baseOptions({ runDir, statePath: join(runDir, "fix-review-wait.json") }),
      { client, ...fakeClock() }
    );
    const events = readFileSync(join(runDir, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const received = events.filter((e) => e.type === "review.received");
    assert.equal(received.length, 1);
    assert.equal(received[0].data.reviewer, "codex");
    assert.equal(received[0].data.head, HEAD);
  });
});

describe("waiting for checks", () => {
  const check = (name, bucket) => ({ name, state: bucket, bucket });
  const reviewed = { reviews: [codexReview(HEAD)] };

  test("checksStatus classifies checks and applies the grace period", () => {
    const now = new Date("2026-11-08T10:01:00Z");
    assert.deepEqual(
      checksStatus([check("ci", "pass"), check("lint", "fail")], {
        headDate: HEAD_DATE,
        now,
        graceSeconds: 120
      }),
      { failing: ["lint"], pending: [], passing: ["ci"], registered: true }
    );
    const inGrace = checksStatus([], {
      headDate: HEAD_DATE,
      now,
      graceSeconds: 120
    });
    assert.equal(inGrace.registered, false);
    assert.equal(inGrace.pending.length, 1);
    assert.deepEqual(
      checksStatus([], { headDate: HEAD_DATE, now, graceSeconds: 30 }).pending,
      []
    );
  });

  test("reviews done and checks pending keeps waiting", async () => {
    const client = fakeClient([
      { ...reviewed, checks: [check("ci", "pending")] },
      { ...reviewed, checks: [check("ci", "pending")] },
      { ...reviewed, checks: [check("ci", "pass")] }
    ]);
    const clock = fakeClock();
    const { result } = await waitForReview(baseOptions({ checks: true }), {
      client,
      ...clock
    });
    assert.equal(result.status, "done");
    assert.equal(client.calls.pr, 3);
    assert.deepEqual(result.outputs.checks, {
      failing: [],
      pending: [],
      passing: ["ci"]
    });
    assert.match(result.summary, /checks passed/);
  });

  test("checks failing and reviews pending keeps waiting", async () => {
    const failing = { checks: [check("ci", "fail")] };
    const client = fakeClient([failing, failing, { ...failing, ...reviewed }]);
    const { result } = await waitForReview(baseOptions({ checks: true }), {
      client,
      ...fakeClock()
    });
    assert.equal(client.calls.pr, 3);
    assert.equal(result.status, "done");
  });

  test("both done with a failing check is done and reports it", async () => {
    const client = fakeClient([
      { ...reviewed, checks: [check("ci", "fail"), check("lint", "pass")] }
    ]);
    const { result } = await waitForReview(baseOptions({ checks: true }), {
      client,
      ...fakeClock()
    });
    assert.equal(result.status, "done");
    assert.deepEqual(result.outputs.checks.failing, ["ci"]);
    assert.deepEqual(result.outputs.checks.passing, ["lint"]);
    assert.match(result.summary, /1 failing \(ci\)/);
    assert.deepEqual(validateArtifact("result", result).errors, []);
  });

  test("an empty check list is pending inside the grace period", async () => {
    // The clock starts 5 minutes after the head commit: a 10 minute grace
    // keeps the wait open until the timeout.
    const client = fakeClient([reviewed]);
    const { result } = await waitForReview(
      baseOptions({ checks: true, checksGraceSeconds: 600, timeoutMinutes: 3 }),
      { client, ...fakeClock() }
    );
    assert.equal(result.status, "awaiting-human");
    assert.match(result.summary, /checks/);
    assert.equal(result.outputs.checks.pending.length, 1);
  });

  test("an empty check list after the grace period counts as no checks", async () => {
    const client = fakeClient([reviewed]);
    const { result } = await waitForReview(
      baseOptions({ checks: true, checksGraceSeconds: 120 }),
      { client, ...fakeClock() }
    );
    assert.equal(result.status, "done");
    assert.equal(client.calls.pr, 1);
    assert.match(result.summary, /no checks/);
    assert.deepEqual(result.outputs.checks, {
      failing: [],
      pending: [],
      passing: []
    });
  });

  test("a timeout with pending checks asks to wait again", async () => {
    const client = fakeClient([
      { ...reviewed, checks: [check("ci", "pending")] }
    ]);
    const { result } = await waitForReview(
      baseOptions({ checks: true, timeoutMinutes: 5 }),
      { client, ...fakeClock() }
    );
    assert.equal(result.status, "awaiting-human");
    assert.equal(result.needs_input.id, "fix-review-wait-timeout");
    assert.match(result.needs_input.question, /checks \(ci\)/);
    assert.deepEqual(result.outputs.checks.pending, ["ci"]);
  });

  test("without --checks the result has no checks output", async () => {
    const client = fakeClient([
      { ...reviewed, checks: [check("ci", "pending")] }
    ]);
    const { result } = await waitForReview(baseOptions(), {
      client,
      ...fakeClock()
    });
    assert.equal(result.status, "done");
    assert.equal(result.outputs.checks, undefined);
  });

  test("checks only, with no reviewers", async () => {
    const client = fakeClient([{ checks: [check("ci", "pass")] }]);
    const { result } = await waitForReview(
      baseOptions({ checks: true, reviewers: [] }),
      { client, ...fakeClock() }
    );
    assert.equal(result.status, "done");
    await assert.rejects(
      waitForReview(baseOptions({ reviewers: [] }), {
        client,
        ...fakeClock()
      }),
      /No reviewers/
    );
  });

  test("a closed pull request with pending checks fails", async () => {
    const client = fakeClient([
      { ...reviewed, state: "CLOSED", checks: [check("ci", "pending")] }
    ]);
    const { result } = await waitForReview(baseOptions({ checks: true }), {
      client,
      ...fakeClock()
    });
    assert.equal(result.status, "failed");
    assert.match(result.summary, /closed and the checks/);
  });
});

describe("CLI", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "esp-wait-cli-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function runCli(args, reviews) {
    const fake = join(dir, "fake-gh.mjs");
    writeFileSync(
      fake,
      `const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", headRefOid: "${HEAD}", isDraft: false }));
} else if (args[0] === "api" && args[1].startsWith("repos/o/r/commits/")) {
  console.log("${HEAD_DATE}");
} else if (args[0] === "api" && args[2].includes("/reviews")) {
  for (const r of ${JSON.stringify(reviews)}) console.log(JSON.stringify(r));
} else if (args[0] === "api" && args[2].includes("/comments")) {
} else if (args[0] === "pr" && args[1] === "checks") {
  console.log(JSON.stringify([{ name: "ci", state: "FAILURE", bucket: "fail", link: "", workflow: "ci" }]));
  process.exit(1);
} else process.exit(3);
`
    );
    const env = {
      ...process.env,
      ESP_GH_CMD: JSON.stringify([process.execPath, fake]),
      ESP_SKILLS_HOME: join(dir, "home")
    };
    return spawnSync(
      process.execPath,
      [SCRIPT, ...args, "--project-dir", dir],
      { encoding: "utf8", env }
    );
  }

  test("prints a result block and exits 0 when reviewed", () => {
    const res = runCli(
      ["7", "--reviewers", "codex", "--once"],
      [codexReview(HEAD)]
    );
    assert.equal(res.status, 0, res.stderr);
    const result = JSON.parse(res.stdout.trim().split("\n").pop());
    assert.equal(result.status, "done");
    assert.deepEqual(validateArtifact("result", result).errors, []);
  });

  test("exits 10 while still pending with --once", () => {
    const res = runCli(
      ["#7", "--reviewers", "codex", "--once"],
      [codexReview(OLD)]
    );
    assert.equal(res.status, 10, res.stderr);
    assert.equal(JSON.parse(res.stdout.trim()).status, "awaiting-human");
  });

  test("--checks reports the checks of the head", () => {
    const res = runCli(
      ["7", "--reviewers", "codex", "--checks", "--once"],
      [codexReview(HEAD)]
    );
    assert.equal(res.status, 0, res.stderr);
    const result = JSON.parse(res.stdout.trim().split("\n").pop());
    assert.deepEqual(result.outputs.checks.failing, ["ci"]);
  });

  test("usage errors exit 2", () => {
    const res = runCli(["feature/x", "--once"], []);
    assert.equal(res.status, 2);
    const bad = runCli(["7", "--poll-seconds", "nope"], []);
    assert.equal(bad.status, 2);
  });

  test("a run dir without run.json is refused", () => {
    const res = runCli(["7", "--once", "--run-dir", join(dir, "missing")], []);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Not a run directory/);
    assert.ok(!existsSync(join(dir, "missing", "fix-review-wait.json")));
  });
});
