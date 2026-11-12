#!/usr/bin/env node
// esp-skills wait primitive for esp-await-review.
//
// Waits until every requested bot reviewer has reviewed the current head SHA
// of a GitHub pull request, without an LLM session polling: the skill starts
// this script in the background and resumes when it exits. Each poll reads
// the pull request, its reviews and its issue comments through `gh`, matches
// reviewer completion on the head SHA, optionally posts the trigger comment of
// a reviewer that needs one, and backs off while nothing changes.
//
// The last stdout line is a contract result block. Progress goes to stderr and
// to the state file, which a session can read while the script runs.
//
// Exit codes follow the contract statuses: 0 done, 10 awaiting-human (timeout,
// or still pending with --once), 1 failed (closed pull request, gh errors),
// 2 usage error.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, findRepoRoot, loadConfig } from "./config.mjs";
import { exitCodeFor, validateArtifact } from "./lib/contract.mjs";
import { appendEvent } from "./runs.mjs";

export class WaitError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "WaitError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
const SHORT_SHA = 7;
const MAX_CONSECUTIVE_ERRORS = 5;
const CODEX_STATE = /<!--\s*codex-review-state:v1\s+(\{.*?\})\s*-->/s;
const IN_PROGRESS =
  /\b(is working|in progress|reviewing now)\b|^\s*:?eyes:?\s*$/i;

// ---------------------------------------------------------------------------
// Reviewers
// ---------------------------------------------------------------------------

/** Compare logins case-insensitively, with or without the `[bot]` suffix (GraphQL drops it). */
export function sameLogin(a, b) {
  const norm = (login) =>
    String(login ?? "")
      .toLowerCase()
      .replace(/\[bot\]$/, "");
  return norm(a) !== "" && norm(a) === norm(b);
}

/**
 * Resolve requested reviewer names to `{ name, login, trigger }`. A name found
 * in `fix-review.wait.reviewers` uses its login and trigger. Any other value is
 * taken as a raw login with no trigger.
 */
export function resolveReviewers(names, configured = {}) {
  const list = (Array.isArray(names) ? names : String(names ?? "").split(","))
    .map((name) => String(name).trim())
    .filter((name) => name !== "");
  if (list.length === 0)
    throw new WaitError("No reviewers to wait for (pass --reviewers)", 2);
  const seen = new Set();
  const reviewers = [];
  for (const name of list) {
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = configured[name];
    reviewers.push(
      entry
        ? { name, login: entry.login, trigger: entry.trigger ?? null }
        : { name, login: name, trigger: null }
    );
  }
  return reviewers;
}

// ---------------------------------------------------------------------------
// Completion matching
// ---------------------------------------------------------------------------

function mentionsSha(text, head) {
  if (!text || !head) return false;
  const lower = text.toLowerCase();
  const sha = head.toLowerCase();
  if (lower.includes(sha)) return true;
  const short = new RegExp(`\\b([0-9a-f]{${SHORT_SHA},40})\\b`, "g");
  for (const match of lower.matchAll(short)) {
    if (sha.startsWith(match[1])) return true;
  }
  return false;
}

/** Parse the machine-readable Codex review state from a summary comment, or null. */
export function codexState(body) {
  const match = CODEX_STATE.exec(body ?? "");
  if (!match) return null;
  try {
    const state = JSON.parse(match[1]);
    const review = state.code_review ?? {};
    return {
      commit_sha: review.commit_sha ?? null,
      status: review.status ?? null
    };
  } catch {
    return null;
  }
}

/**
 * Decide the state of one reviewer for one head SHA.
 *
 * Completion signals, strongest first:
 * 1. A pull request review by the login whose `commit_id` is the head SHA.
 * 2. A comment by the login carrying a machine-readable review state for the
 *    head SHA with status `completed` (Codex summary comment).
 * 3. A comment by the login without such a state, created or edited at or
 *    after the head commit date, that is not a progress placeholder.
 *
 * Returns `{ status: reviewed|in-progress|pending, kind, url, at, stale }`.
 * `stale` counts reviews by the login on other commits.
 */
export function reviewerStatus(reviewer, snapshot) {
  const { head, headDate, reviews = [], comments = [] } = snapshot;
  const mine = reviews.filter((r) => sameLogin(r.login, reviewer.login));
  const stale = mine.filter((r) => r.commit_id && r.commit_id !== head).length;
  const onHead = mine
    .filter((r) => r.commit_id === head && r.state !== "PENDING")
    .sort((a, b) =>
      String(b.submitted_at).localeCompare(String(a.submitted_at))
    );
  if (onHead.length > 0) {
    const review = onHead[0];
    return {
      status: "reviewed",
      kind: "review",
      state: review.state ?? null,
      id: review.id ?? null,
      url: review.html_url ?? null,
      at: review.submitted_at ?? null,
      stale
    };
  }

  let inProgress = null;
  const byLogin = comments
    .filter((c) => sameLogin(c.login, reviewer.login))
    .sort((a, b) =>
      String(b.updated_at ?? b.created_at).localeCompare(
        String(a.updated_at ?? a.created_at)
      )
    );
  for (const comment of byLogin) {
    const at = comment.updated_at ?? comment.created_at ?? null;
    const state = codexState(comment.body);
    if (state) {
      if (state.commit_sha && state.commit_sha === head) {
        if (state.status === "completed") {
          return {
            status: "reviewed",
            kind: "comment",
            state: "COMMENTED",
            id: comment.id ?? null,
            url: comment.html_url ?? null,
            at,
            stale
          };
        }
        inProgress ??= {
          status: "in-progress",
          kind: "comment",
          state: state.status,
          id: comment.id ?? null,
          url: comment.html_url ?? null,
          at,
          stale
        };
      }
      continue;
    }
    const recent =
      headDate && at
        ? Date.parse(at) >= Date.parse(headDate)
        : mentionsSha(comment.body, head);
    if (!recent) continue;
    if (IN_PROGRESS.test(comment.body ?? "")) {
      inProgress ??= {
        status: "in-progress",
        kind: "comment",
        state: null,
        id: comment.id ?? null,
        url: comment.html_url ?? null,
        at,
        stale
      };
      continue;
    }
    return {
      status: "reviewed",
      kind: "comment",
      state: "COMMENTED",
      id: comment.id ?? null,
      url: comment.html_url ?? null,
      at,
      stale
    };
  }
  return (
    inProgress ?? {
      status: "pending",
      kind: null,
      state: null,
      id: null,
      url: null,
      at: null,
      stale
    }
  );
}

/** True when a comment posting `trigger` already exists for the head (created at or after the head commit). */
export function triggerPosted(trigger, snapshot) {
  if (!trigger) return false;
  const wanted = trigger.trim().toLowerCase();
  return (snapshot.comments ?? []).some((c) => {
    if (
      !String(c.body ?? "")
        .trim()
        .toLowerCase()
        .startsWith(wanted)
    )
      return false;
    if (!snapshot.headDate) return true;
    return Date.parse(c.created_at ?? 0) >= Date.parse(snapshot.headDate);
  });
}

// ---------------------------------------------------------------------------
// GitHub client
// ---------------------------------------------------------------------------

function exec(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (res.error)
    throw new WaitError(`${cmd} could not run: ${res.error.message}`);
  return res;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** Parse `owner/repo` from a pull request URL. */
export function repoFromUrl(url) {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i.exec(url ?? "");
  if (!match)
    throw new WaitError(
      `Cannot read the repository from the pull request URL: ${url}`
    );
  return `${match[1]}/${match[2]}`;
}

/** A `gh`-backed client. `ESP_GH_CMD` (a JSON array) replaces `gh`, for tests. */
export function ghClient({ cwd, env = process.env } = {}) {
  const prefix = env.ESP_GH_CMD ? JSON.parse(env.ESP_GH_CMD) : ["gh"];
  const gh = (args) => {
    const res = exec(prefix[0], [...prefix.slice(1), ...args], cwd);
    if (res.status !== 0)
      throw new WaitError(
        `gh ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim()}`
      );
    return res.stdout;
  };
  return {
    pr(target) {
      const args = ["pr", "view"];
      if (target) args.push(String(target));
      args.push("--json", "number,url,state,headRefOid,isDraft");
      const pr = JSON.parse(gh(args));
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        head: pr.headRefOid,
        draft: Boolean(pr.isDraft)
      };
    },
    commitDate(repo, sha) {
      const out = gh([
        "api",
        `repos/${repo}/commits/${sha}`,
        "--jq",
        ".commit.committer.date"
      ]).trim();
      return out === "" || out === "null" ? null : out;
    },
    reviews(repo, number) {
      return parseJsonLines(
        gh([
          "api",
          "--paginate",
          `repos/${repo}/pulls/${number}/reviews?per_page=100`,
          "--jq",
          ".[] | {id, login: .user.login, commit_id, state, submitted_at, html_url}"
        ])
      );
    },
    comments(repo, number) {
      return parseJsonLines(
        gh([
          "api",
          "--paginate",
          `repos/${repo}/issues/${number}/comments?per_page=100`,
          "--jq",
          ".[] | {id, login: .user.login, body, created_at, updated_at, html_url}"
        ])
      );
    },
    comment(number, body) {
      gh(["pr", "comment", String(number), "--body", body]);
    }
  };
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function readState(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeState(path, state) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Wait loop
// ---------------------------------------------------------------------------

/** Next poll interval in seconds: base * factor^idle, capped. */
export function nextInterval(base, factor, idlePolls, cap) {
  return Math.min(cap, Math.round(base * factor ** idlePolls));
}

function needsInput(pending, minutes) {
  return {
    id: "await-review-timeout",
    question: `No review from ${pending.join(", ")} on the head commit after ${minutes} minute${minutes === 1 ? "" : "s"}. Wait again or continue without it?`,
    options: [
      {
        id: "wait",
        label: "Wait again",
        description: "Run esp-await-review again with the same reviewers"
      },
      {
        id: "skip",
        label: "Continue without the review",
        description: "Treat the missing reviews as not coming"
      }
    ],
    recommended: "wait",
    blocking: true
  };
}

/**
 * Wait for reviewers. Options: `pr`, `reviewers` (resolved), `timeoutMinutes`,
 * `pollSeconds`, `maxPollSeconds`, `backoff`, `trigger`, `once`, `statePath`,
 * `runDir`. Deps: `client`, `sleep(ms)`, `now()` (Date), `log(line)`, `env`.
 * Returns `{ result, state }`.
 */
export async function waitForReview(options, deps) {
  const {
    client,
    sleep,
    now = () => new Date(),
    log = () => {},
    env = process.env
  } = deps;
  const reviewers = options.reviewers;
  const timeoutMs = options.timeoutMinutes * 60_000;
  const base = options.pollSeconds;
  const cap = Math.max(base, options.maxPollSeconds ?? base * 5);
  const factor = options.backoff ?? 1.5;

  const previous = readState(options.statePath);
  const startedAt = now();
  const state = {
    state_format: STATE_FORMAT,
    pr: null,
    url: null,
    repo: null,
    head: null,
    head_date: null,
    started_at: startedAt.toISOString(),
    updated_at: startedAt.toISOString(),
    ended_at: null,
    timeout_minutes: options.timeoutMinutes,
    polls: 0,
    status: "waiting",
    reviewers: {},
    triggered: Array.isArray(previous?.triggered) ? previous.triggered : [],
    heads: Array.isArray(previous?.heads) ? previous.heads : [],
    errors: []
  };
  // An interrupted wait (no ended_at) on the same pull request keeps its clock.
  const samePr =
    options.pr == null ||
    String(previous?.pr) === String(options.pr) ||
    previous?.url === options.pr;
  if (previous && !previous.ended_at && previous.started_at && samePr) {
    state.started_at = previous.started_at;
  }
  const deadline = Date.parse(state.started_at) + timeoutMs;
  const announced = new Set(
    Object.entries(previous?.reviewers ?? {})
      .filter(([, r]) => r.status === "reviewed" && r.head === previous.head)
      .map(([name]) => `${name}@${previous.head}`)
  );

  let idle = 0;
  let consecutiveErrors = 0;
  let lastKey = null;

  const finish = (status, summary, extra = {}) => {
    state.status = status;
    state.ended_at = now().toISOString();
    state.updated_at = state.ended_at;
    writeState(options.statePath, state);
    const names = reviewers.map((r) => r.name);
    const completed = names.filter(
      (n) => state.reviewers[n]?.status === "reviewed"
    );
    const pending = names.filter((n) => !completed.includes(n));
    const result = {
      contract_version: 1,
      status,
      summary,
      max_risk: "low",
      outputs: {
        pr: state.pr,
        url: state.url,
        head: state.head,
        reviewers: Object.fromEntries(
          names.map((n) => [n, state.reviewers[n]?.status ?? "pending"])
        ),
        completed,
        pending,
        triggered: state.triggered
          .filter((t) => t.head === state.head)
          .map((t) => t.reviewer),
        polls: state.polls,
        waited_seconds: Math.max(
          0,
          Math.round(
            (Date.parse(state.ended_at) - Date.parse(state.started_at)) / 1000
          )
        ),
        state_path: options.statePath ?? null
      },
      ...extra
    };
    const { errors } = validateArtifact("result", result);
    if (errors.length > 0)
      throw new WaitError(
        `Internal error, invalid result block: ${errors.map((e) => `${e.path} ${e.message}`).join("; ")}`
      );
    return { result, state };
  };

  for (;;) {
    state.polls += 1;
    let snapshot;
    let closedState = null;
    try {
      const pr = client.pr(options.pr);
      state.pr = pr.number;
      state.url = pr.url;
      state.repo ??= repoFromUrl(pr.url);
      closedState =
        pr.state && pr.state !== "OPEN" ? pr.state.toLowerCase() : null;
      if (pr.head !== state.head) {
        if (state.head)
          log(
            `head changed: ${state.head.slice(0, SHORT_SHA)} -> ${pr.head.slice(0, SHORT_SHA)}, waiting on the new head`
          );
        state.head = pr.head;
        state.head_date = client.commitDate(state.repo, pr.head);
        if (!state.heads.includes(pr.head)) state.heads.push(pr.head);
        idle = 0;
      }
      snapshot = {
        head: state.head,
        headDate: state.head_date,
        reviews: client.reviews(state.repo, state.pr),
        comments: client.comments(state.repo, state.pr)
      };
      consecutiveErrors = 0;
    } catch (err) {
      if (!(err instanceof WaitError) && !(err instanceof SyntaxError))
        throw err;
      consecutiveErrors += 1;
      state.errors = [
        ...state.errors,
        { at: now().toISOString(), message: err.message }
      ].slice(-10);
      log(`poll ${state.polls}: ${err.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS || options.once) {
        return finish(
          "failed",
          `gh failed ${consecutiveErrors} time(s) in a row: ${err.message}`
        );
      }
      writeState(options.statePath, state);
      await sleep(nextInterval(base, factor, idle++, cap) * 1000);
      continue;
    }

    for (const reviewer of reviewers) {
      const status = reviewerStatus(reviewer, snapshot);
      state.reviewers[reviewer.name] = {
        login: reviewer.login,
        head: state.head,
        ...status
      };
      const key = `${reviewer.name}@${state.head}`;
      if (status.status === "reviewed" && !announced.has(key)) {
        announced.add(key);
        log(
          `${reviewer.name} reviewed ${state.head.slice(0, SHORT_SHA)} (${status.kind})`
        );
        if (options.runDir) {
          appendEvent(
            options.runDir,
            "review.received",
            {
              reviewer: reviewer.name,
              login: reviewer.login,
              pr: state.pr,
              head: state.head,
              kind: status.kind,
              state: status.state,
              url: status.url
            },
            env
          );
        }
      }
    }

    const pending = reviewers.filter(
      (r) => state.reviewers[r.name].status !== "reviewed"
    );
    if (pending.length === 0) {
      const names = reviewers.map((r) => r.name).join(", ");
      return finish(
        "done",
        `${names} reviewed #${state.pr} at ${state.head.slice(0, SHORT_SHA)}.`
      );
    }
    if (closedState) {
      const missing = pending.map((r) => r.name).join(", ");
      return finish(
        "failed",
        `Pull request #${state.pr} is ${closedState} and ${missing} did not review its head, nothing to wait for.`
      );
    }

    // Trigger comments: once per reviewer and head, never on the first poll of
    // a head (the reviewer may start on its own), never when it is in progress.
    if (options.trigger && !options.once) {
      for (const reviewer of pending) {
        if (
          !reviewer.trigger ||
          state.reviewers[reviewer.name].status === "in-progress"
        )
          continue;
        if (
          state.triggered.some(
            (t) => t.reviewer === reviewer.name && t.head === state.head
          )
        )
          continue;
        if (triggerPosted(reviewer.trigger, snapshot)) {
          state.triggered.push({
            reviewer: reviewer.name,
            head: state.head,
            at: now().toISOString(),
            posted: false
          });
          continue;
        }
        if (lastKey === null || !lastKey.startsWith(`${state.head}|`)) continue;
        try {
          client.comment(state.pr, reviewer.trigger);
          state.triggered.push({
            reviewer: reviewer.name,
            head: state.head,
            at: now().toISOString(),
            posted: true
          });
          log(`posted trigger for ${reviewer.name}: ${reviewer.trigger}`);
          idle = 0;
        } catch (err) {
          if (!(err instanceof WaitError)) throw err;
          state.errors = [
            ...state.errors,
            { at: now().toISOString(), message: err.message }
          ].slice(-10);
          log(`trigger for ${reviewer.name} failed: ${err.message}`);
        }
      }
    }

    const pendingNames = pending.map((r) => r.name);
    if (options.once) {
      return finish(
        "awaiting-human",
        `Still waiting for ${pendingNames.join(", ")} on #${state.pr} at ${state.head.slice(0, SHORT_SHA)}.`
      );
    }
    const remaining = deadline - now().getTime();
    if (remaining <= 0) {
      return finish(
        "awaiting-human",
        `Timed out after ${options.timeoutMinutes} min waiting for ${pendingNames.join(", ")} on #${state.pr} at ${state.head.slice(0, SHORT_SHA)}.`,
        { needs_input: needsInput(pendingNames, options.timeoutMinutes) }
      );
    }

    const key = `${state.head}|${reviewers.map((r) => `${r.name}:${state.reviewers[r.name].status}`).join(",")}`;
    if (key !== lastKey) idle = 0;
    lastKey = key;
    const wait = Math.min(
      nextInterval(base, factor, idle++, cap) * 1000,
      remaining
    );
    state.updated_at = now().toISOString();
    state.next_poll_at = new Date(now().getTime() + wait).toISOString();
    writeState(options.statePath, state);
    log(
      `poll ${state.polls}: waiting for ${pendingNames.join(", ")} on ${state.head.slice(0, SHORT_SHA)}, next poll in ${Math.round(wait / 1000)}s`
    );
    await sleep(wait);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node wait-for-review.mjs [pr] [options]

Waits until every reviewer has reviewed the head commit of a pull request.
[pr] is a number, #<n>, or a URL (default: the pull request of the current branch).
The last stdout line is a contract result block; progress goes to stderr.

Options:
  --reviewers <a,b>          Reviewer names from fix-review.wait.reviewers, or raw logins
                             (default: fix-review.wait.default_reviewers)
  --timeout-minutes <n>      Give up after n minutes (default: fix-review.wait.timeout_minutes)
  --poll-seconds <n>         First poll interval (default: fix-review.wait.poll_seconds)
  --max-poll-seconds <n>     Backoff cap (default: 5 x poll seconds)
  --backoff <factor>         Interval multiplier while nothing changes (default 1.5)
  --trigger / --no-trigger   Post trigger comments (default: fix-review.wait.auto_trigger)
  --once                     Check once and exit (0 done, 10 still pending)
  --state <file>             Progress file (default: <run-dir>/await-review.json)
  --run-dir <path>           Run directory: state file location and review.received events
  --config-snapshot <path>   Config snapshot to read instead of the user and project layers
  --project-dir <dir>        Repository (default: nearest git root, else cwd)
  --help                     Show this help

Exit codes: 0 done, 10 awaiting-human, 1 failed, 2 usage error.

Environment:
  ESP_GH_CMD                 JSON array replacing the gh command (tests)`;

const BOOLEAN_OPTIONS = new Set(["trigger", "no-trigger", "once", "help"]);

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (BOOLEAN_OPTIONS.has(key) && eq === -1) {
        options[key] = true;
        continue;
      }
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined)
        throw new WaitError(`--${key} requires a value`, 2);
      options[key] = value;
    } else positional.push(arg);
  }
  return { options, positional };
}

/** Normalize a pull request argument (`12`, `#12`, `PR 12`, URL) for `gh pr view`. */
export function prArgument(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  if (/^https?:\/\//i.test(value)) return value;
  const match = /^(?:pr\s*)?#?(\d+)$/i.exec(value);
  if (!match) throw new WaitError(`Unrecognized pull request: ${value}`, 2);
  return match[1];
}

function positiveNumber(raw, name, min) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min)
    throw new WaitError(`--${name} must be a number >= ${min}`, 2);
  return value;
}

/** Build waitForReview options from CLI options and config. */
export function resolveOptions(cli, positional, env = process.env) {
  const projectDir = resolve(
    cli["project-dir"] ?? findRepoRoot(process.cwd()) ?? process.cwd()
  );
  let config;
  try {
    ({ config } = loadConfig({
      projectDir,
      snapshot: cli["config-snapshot"],
      env
    }));
  } catch (err) {
    if (err instanceof ConfigError)
      throw new WaitError(err.message, err.exitCode ?? 1);
    throw err;
  }
  const section = config["fix-review"]?.wait ?? {};
  const runDir = cli["run-dir"] ? resolve(cli["run-dir"]) : null;
  if (runDir && !existsSync(join(runDir, "run.json")))
    throw new WaitError(`Not a run directory (no run.json): ${runDir}`, 2);
  const pollSeconds =
    cli["poll-seconds"] !== undefined
      ? positiveNumber(cli["poll-seconds"], "poll-seconds", 1)
      : (section.poll_seconds ?? 60);
  return {
    projectDir,
    pr: prArgument(positional.join(" ")),
    reviewers: resolveReviewers(
      cli.reviewers ?? section.default_reviewers ?? [],
      section.reviewers ?? {}
    ),
    timeoutMinutes:
      cli["timeout-minutes"] !== undefined
        ? positiveNumber(cli["timeout-minutes"], "timeout-minutes", 0)
        : (section.timeout_minutes ?? 30),
    pollSeconds,
    maxPollSeconds:
      cli["max-poll-seconds"] !== undefined
        ? positiveNumber(cli["max-poll-seconds"], "max-poll-seconds", 1)
        : pollSeconds * 5,
    backoff:
      cli.backoff !== undefined
        ? positiveNumber(cli.backoff, "backoff", 1)
        : 1.5,
    trigger: cli["no-trigger"]
      ? false
      : cli.trigger
        ? true
        : Boolean(section.auto_trigger),
    once: Boolean(cli.once),
    statePath: cli.state
      ? resolve(cli.state)
      : runDir
        ? join(runDir, "await-review.json")
        : null,
    runDir
  };
}

export async function run(argv, env = process.env, io = {}) {
  const { options: cli, positional } = parseArgs(argv);
  if (cli.help) return { output: USAGE, exitCode: 0 };
  const options = resolveOptions(cli, positional, env);
  const log =
    io.log ?? ((line) => process.stderr.write(`[wait-for-review] ${line}\n`));
  const { result } = await waitForReview(options, {
    client: io.client ?? ghClient({ cwd: options.projectDir, env }),
    sleep: io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    now: io.now,
    log,
    env
  });
  return {
    output: JSON.stringify(result),
    exitCode: exitCodeFor(result.status)
  };
}

async function main() {
  try {
    const { output, exitCode } = await run(process.argv.slice(2));
    process.stdout.write(`${output}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = err instanceof WaitError;
    process.stderr.write(
      `wait-for-review error: ${known ? err.message : (err.stack ?? err)}\n`
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
