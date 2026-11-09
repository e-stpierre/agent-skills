#!/usr/bin/env node
// esp-skills review-fix bookkeeping for esp-fix-review.
//
// Fetches the review items of a GitHub pull request (inline comments, review
// bodies, issue comments) or of an esp-review findings file, filters them by
// reviewer and by the handled IDs already recorded, tracks the bounded fix
// rounds, records how each item was resolved (and logs the decision), posts
// the replies and resolves the threads on GitHub, and builds the contract
// result block. The model classifies and fixes; this script keeps the state.
//
// State: <run-dir>/fix-review.json with --run-dir, else --state <file>.
// `ESP_GH_CMD` (a JSON array) replaces `gh`, for tests.
//
// Exit codes: 0 ok, 1 failure, 2 usage error. `result` exits with the
// contract code of its status (0 done, 10 awaiting-human, 20 halted).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, expandHome, findRepoRoot, loadConfig } from "./config.mjs";
import { exitCodeFor, maxRisk, validateArtifact } from "./lib/contract.mjs";
import { withLock } from "./lib/lock.mjs";
import { appendDecision, now } from "./runs.mjs";
import { prArgument, repoFromUrl, resolveReviewers, sameLogin } from "./wait-for-review.mjs";

export class FixReviewError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "FixReviewError";
    this.exitCode = exitCode;
  }
}

export const STATE_FORMAT = 1;
export const RESOLUTIONS = ["fixed", "rejected", "deferred", "skipped", "open"];
export const CLASSES = ["A-Fix", "B-Decide", "B-Scope", "Reject", "Halt"];
const DEFAULT_RISK = { fixed: "low", rejected: "low", deferred: "medium", skipped: "low", open: "high" };
const RESOLUTION_CLASSES = {
  fixed: ["A-Fix", "B-Decide"],
  rejected: ["Reject"],
  deferred: ["B-Scope", "B-Decide", "A-Fix", "Halt"],
  skipped: ["Reject"],
  open: ["B-Decide", "B-Scope", "Halt"]
};
const SHORT_SHA = 7;

// ---------------------------------------------------------------------------
// gh client
// ---------------------------------------------------------------------------

function parseJsonLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved isOutdated comments(first: 100) { nodes { databaseId } } }
      }
    }
  }
}`;

/** A `gh`-backed client. `ESP_GH_CMD` (a JSON array) replaces `gh`, for tests. */
export function ghClient({ cwd, env = process.env } = {}) {
  const prefix = env.ESP_GH_CMD ? JSON.parse(env.ESP_GH_CMD) : ["gh"];
  const gh = (args, { okStatuses = [0] } = {}) => {
    const res = spawnSync(prefix[0], [...prefix.slice(1), ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    if (res.error) throw new FixReviewError(`gh could not run: ${res.error.message}`);
    if (!okStatuses.includes(res.status))
      throw new FixReviewError(`gh ${args.slice(0, 3).join(" ")} failed: ${(res.stderr || res.stdout).trim()}`);
    return res.stdout;
  };
  const list = (path, jq) => parseJsonLines(gh(["api", "--paginate", `${path}?per_page=100`, "--jq", jq]));
  return {
    pr(target) {
      const args = ["pr", "view"];
      if (target) args.push(String(target));
      args.push("--json", "number,url,state,headRefOid,headRefName,baseRefName,isDraft");
      const pr = JSON.parse(gh(args));
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        head: pr.headRefOid,
        branch: pr.headRefName,
        base: pr.baseRefName,
        draft: Boolean(pr.isDraft)
      };
    },
    user() {
      try {
        return gh(["api", "user", "--jq", ".login"]).trim() || null;
      } catch {
        return null;
      }
    },
    inlineComments(repo, number) {
      return list(
        `repos/${repo}/pulls/${number}/comments`,
        ".[] | {id, node_id, login: .user.login, user_type: .user.type, body, path, line, original_line, commit_id, in_reply_to_id, created_at, html_url}"
      );
    },
    reviews(repo, number) {
      return list(
        `repos/${repo}/pulls/${number}/reviews`,
        ".[] | {id, node_id, login: .user.login, user_type: .user.type, body, state, commit_id, submitted_at, html_url}"
      );
    },
    issueComments(repo, number) {
      return list(
        `repos/${repo}/issues/${number}/comments`,
        ".[] | {id, node_id, login: .user.login, user_type: .user.type, body, created_at, updated_at, html_url}"
      );
    },
    threads(repo, number) {
      const [owner, name] = repo.split("/");
      return parseJsonLines(
        gh([
          "api",
          "graphql",
          "--paginate",
          "-f",
          `query=${THREADS_QUERY}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `name=${name}`,
          "-F",
          `number=${number}`,
          "--jq",
          ".data.repository.pullRequest.reviewThreads.nodes[] | {id, isResolved, isOutdated, comments: [.comments.nodes[].databaseId]}"
        ])
      );
    },
    checks(number) {
      // gh pr checks exits 8 while checks are pending and 1 when one failed.
      const out = gh(["pr", "checks", String(number), "--json", "name,state,bucket,link,workflow"], {
        okStatuses: [0, 1, 8]
      });
      return out.trim() === "" ? [] : JSON.parse(out);
    },
    replyInline(repo, number, commentId, body) {
      const out = gh([
        "api",
        `repos/${repo}/pulls/${number}/comments`,
        "-f",
        `body=${body}`,
        "-F",
        `in_reply_to=${commentId}`,
        "--jq",
        ".html_url"
      ]);
      return out.trim() || null;
    },
    comment(repo, number, body) {
      const out = gh(["api", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`, "--jq", ".html_url"]);
      return out.trim() || null;
    },
    resolveThread(threadId) {
      gh([
        "api",
        "graphql",
        "-f",
        "query=mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }",
        "-F",
        `id=${threadId}`
      ]);
    },
    minimize(nodeId) {
      gh([
        "api",
        "graphql",
        "-f",
        "query=mutation($id: ID!) { minimizeComment(input: {subjectId: $id, classifier: RESOLVED}) { minimizedComment { isMinimized } } }",
        "-F",
        `id=${nodeId}`
      ]);
    }
  };
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function emptyState(at) {
  return {
    state_format: STATE_FORMAT,
    mode: null,
    pr: null,
    url: null,
    repo: null,
    head: null,
    created_at: at,
    updated_at: at,
    max_rounds: null,
    rounds: [],
    items: {},
    handled: {}
  };
}

export function readState(path, env = process.env) {
  if (!path || !existsSync(path)) return emptyState(now(env).toISOString());
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (state.state_format !== STATE_FORMAT) throw new Error(`unsupported state_format ${state.state_format}`);
    return state;
  } catch (err) {
    throw new FixReviewError(`${path}: unreadable fix-review state (${err.message})`);
  }
}

function writeState(path, state, env) {
  if (!path) return;
  state.updated_at = now(env).toISOString();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Read-modify-write the state under its lock. */
function updateState(path, env, fn) {
  if (!path) {
    const state = emptyState(now(env).toISOString());
    return fn(state);
  }
  mkdirSync(dirname(path), { recursive: true });
  return withLock(path, () => {
    const state = readState(path, env);
    const out = fn(state);
    writeState(path, state, env);
    return out;
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function isBot(login, type) {
  return type === "Bot" || /\[bot\]$/i.test(String(login ?? ""));
}

function matchesReviewers(login, reviewers) {
  return reviewers.length === 0 || reviewers.some((r) => sameLogin(r.login, login) || sameLogin(r.name, login));
}

/**
 * Turn raw PR data into review items. `data`: `{ inline, reviews, comments,
 * threads }` as returned by the client. Returns `{ items, skipped, authors }`.
 */
export function collectItems(data, { reviewers = [], ownLogin = null, handled = {}, includeHandled = false } = {}) {
  const threadOf = new Map();
  for (const thread of data.threads ?? []) {
    for (const id of thread.comments ?? []) threadOf.set(String(id), thread);
  }
  const candidates = [];
  for (const c of data.inline ?? []) {
    const thread = threadOf.get(String(c.id)) ?? null;
    candidates.push({
      id: `inline:${c.id}`,
      kind: "inline",
      comment_id: c.id,
      node_id: c.node_id ?? null,
      thread_id: thread?.id ?? null,
      resolved: Boolean(thread?.isResolved),
      outdated: Boolean(thread?.isOutdated),
      author: c.login,
      bot: isBot(c.login, c.user_type),
      body: c.body ?? "",
      path: c.path ?? null,
      line: c.line ?? c.original_line ?? null,
      commit: c.commit_id ?? null,
      in_reply_to: c.in_reply_to_id ?? null,
      created_at: c.created_at ?? null,
      url: c.html_url ?? null
    });
  }
  for (const r of data.reviews ?? []) {
    if (String(r.body ?? "").trim() === "" || r.state === "PENDING") continue;
    candidates.push({
      id: `review:${r.id}`,
      kind: "review",
      comment_id: r.id,
      node_id: r.node_id ?? null,
      thread_id: null,
      resolved: false,
      outdated: false,
      author: r.login,
      bot: isBot(r.login, r.user_type),
      body: r.body,
      state: r.state ?? null,
      commit: r.commit_id ?? null,
      created_at: r.submitted_at ?? null,
      url: r.html_url ?? null
    });
  }
  for (const c of data.comments ?? []) {
    if (String(c.body ?? "").trim() === "") continue;
    candidates.push({
      id: `comment:${c.id}`,
      kind: "comment",
      comment_id: c.id,
      node_id: c.node_id ?? null,
      thread_id: null,
      resolved: false,
      outdated: false,
      author: c.login,
      bot: isBot(c.login, c.user_type),
      body: c.body,
      created_at: c.created_at ?? null,
      updated_at: c.updated_at ?? null,
      url: c.html_url ?? null
    });
  }
  const skipped = { handled: 0, own: 0, resolved: 0, filtered: 0 };
  const items = [];
  const authors = new Set();
  for (const item of candidates) {
    if (ownLogin && sameLogin(item.author, ownLogin)) skipped.own++;
    else if (!matchesReviewers(item.author, reviewers)) skipped.filtered++;
    else if (item.resolved) skipped.resolved++;
    else if (handled[item.id] && !includeHandled) {
      skipped.handled++;
      authors.add(item.author);
    } else {
      items.push(item);
      authors.add(item.author);
    }
  }
  items.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return { items, skipped, authors: [...authors] };
}

/** Turn an esp-review findings file (`review_format: 1`) into items. */
export function findingItems(findings, source, { handled = {}, includeHandled = false } = {}) {
  if (findings?.review_format !== 1 || !Array.isArray(findings.findings))
    throw new FixReviewError(`${source}: not an esp-review findings file (review_format 1)`);
  const tag = source.replace(/\\/g, "/").split("/").pop().replace(/\.json$/, "");
  const items = [];
  let skippedHandled = 0;
  for (const f of findings.findings) {
    const item = {
      id: `finding:${tag}:${f.id}`,
      kind: "finding",
      finding: f.id,
      class: f.class,
      severity: f.severity,
      dimension: f.dimension,
      location: f.location ?? null,
      title: f.title ?? null,
      evidence: f.evidence ?? null,
      fix: f.fix ?? null,
      options: f.options ?? [],
      recommended: f.recommended ?? null,
      decision: f.decision ?? null
    };
    if (handled[item.id] && !includeHandled) skippedHandled++;
    else items.push(item);
  }
  return { items, skipped: { handled: skippedHandled } };
}

/** Latest `review-<N>.json` in a run directory. */
export function latestFindings(runDir) {
  const files = existsSync(runDir) ? readdirSync(runDir).filter((f) => /^review-\d+\.json$/.test(f)) : [];
  if (files.length === 0) return null;
  files.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return join(runDir, files.at(-1));
}

/** Summarize `gh pr checks` output for one head. */
export function summarizeChecks(checks, head, handled = {}) {
  const sha = String(head ?? "").slice(0, SHORT_SHA);
  const failing = [];
  const pending = [];
  let passing = 0;
  let skipped = 0;
  for (const check of checks) {
    const bucket = check.bucket ?? String(check.state ?? "").toLowerCase();
    const entry = {
      id: `check:${check.name}@${sha}`,
      kind: "check",
      name: check.name,
      workflow: check.workflow ?? null,
      state: check.state ?? null,
      link: check.link ?? null
    };
    if (bucket === "fail" || bucket === "cancel") {
      entry.handled = Boolean(handled[entry.id]);
      failing.push(entry);
    } else if (bucket === "pending") pending.push(entry);
    else if (bucket === "skipping") skipped++;
    else passing++;
  }
  return { head, total: checks.length, passing, skipped, failing, pending };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** First meaningful line of a comment, for quote replies. */
export function excerpt(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("<!--"));
  return line ? line.slice(0, 200) : null;
}

function storeItems(state, items) {
  for (const item of items) {
    const { body, evidence: _evidence, ...meta } = item;
    state.items[item.id] = { ...meta, excerpt: excerpt(body ?? item.title) };
  }
}

export function cmdFetch(ctx, target) {
  const { client, statePath, env, reviewers } = ctx;
  const pr = client.pr(target);
  const repo = repoFromUrl(pr.url);
  const ownLogin = client.user();
  const data = {
    inline: client.inlineComments(repo, pr.number),
    reviews: client.reviews(repo, pr.number),
    comments: client.issueComments(repo, pr.number),
    threads: client.threads(repo, pr.number)
  };
  return updateState(statePath, env, (state) => {
    if (state.pr != null && state.pr !== pr.number)
      throw new FixReviewError(`State file belongs to pull request ${state.pr}, not ${pr.number}`, 2);
    Object.assign(state, { mode: "pr", pr: pr.number, url: pr.url, repo, head: pr.head });
    const { items, skipped, authors } = collectItems(data, {
      reviewers,
      ownLogin,
      handled: state.handled,
      includeHandled: ctx.includeHandled
    });
    storeItems(state, items);
    const seen = reviewers.filter((r) => authors.some((a) => sameLogin(a, r.login))).map((r) => r.name);
    return {
      mode: "pr",
      pr: pr.number,
      url: pr.url,
      repo,
      head: pr.head,
      branch: pr.branch,
      base: pr.base,
      state: pr.state,
      draft: pr.draft,
      own_login: ownLogin,
      round: state.rounds.at(-1)?.n ?? 0,
      reviewers: reviewers.map((r) => r.name),
      reviewers_seen: seen,
      items,
      skipped,
      pending_github: pendingGithub(state).map((h) => h.id),
      state_path: statePath
    };
  });
}

export function cmdInternal(ctx, file) {
  const { statePath, env, runDir } = ctx;
  const path = file ? resolve(expandHome(file)) : runDir ? latestFindings(runDir) : null;
  if (!path) throw new FixReviewError("internal needs a findings file, or --run-dir holding review-<N>.json", 2);
  if (!existsSync(path)) throw new FixReviewError(`Findings file not found: ${path}`, 2);
  let findings;
  try {
    findings = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new FixReviewError(`${path}: invalid JSON (${err.message})`);
  }
  return updateState(statePath, env, (state) => {
    if (state.mode === "pr") throw new FixReviewError("State file belongs to a pull request fix-review", 2);
    Object.assign(state, { mode: "internal", head: findings.head ?? null });
    const { items, skipped } = findingItems(findings, path, { handled: state.handled, includeHandled: ctx.includeHandled });
    storeItems(state, items);
    return {
      mode: "internal",
      findings_path: path,
      base: findings.base ?? null,
      head: findings.head ?? null,
      round: state.rounds.at(-1)?.n ?? 0,
      items,
      skipped,
      state_path: statePath
    };
  });
}

export function cmdChecks(ctx, target) {
  const { client, statePath, env } = ctx;
  const pr = client.pr(target);
  const summary = summarizeChecks(client.checks(pr.number), pr.head, statePath ? readState(statePath, env).handled : {});
  if (statePath) {
    updateState(statePath, env, (state) => {
      storeItems(state, summary.failing);
    });
  }
  return { pr: pr.number, url: pr.url, ...summary };
}

export function cmdRound(ctx) {
  const { statePath, env, maxRounds } = ctx;
  return updateState(statePath, env, (state) => {
    state.max_rounds = maxRounds;
    const done = state.rounds.length;
    if (done >= maxRounds) return { round: null, exhausted: true, rounds: done, max_rounds: maxRounds };
    const round = { n: done + 1, started_at: now(env).toISOString(), head: state.head ?? null };
    state.rounds.push(round);
    return { round: round.n, exhausted: false, rounds: round.n, max_rounds: maxRounds, last: round.n === maxRounds };
  });
}

/** GitHub actions owed for a handled item, from its resolution and kind. */
export function githubActions(item, resolution, { reply, replyToRejected = true, deferredItems = "follow-up" } = {}) {
  const actions = { reply: false, resolve: false, minimize: false };
  if (!item || item.kind === "finding" || item.kind === "check") return actions;
  const hasReply = typeof reply === "string" && reply.trim() !== "";
  actions.reply = hasReply && !(resolution === "rejected" && !replyToRejected);
  const resolvable = item.kind === "inline" && Boolean(item.thread_id);
  if (resolution === "fixed") {
    actions.resolve = resolvable;
    actions.minimize = item.kind === "comment" && item.bot && Boolean(item.node_id);
  } else if (resolution === "deferred") {
    actions.resolve = resolvable && deferredItems !== "block";
  } else if (resolution === "rejected") {
    actions.resolve = resolvable && item.bot;
  }
  return actions;
}

function pendingGithub(state) {
  return Object.entries(state.handled)
    .filter(([, h]) => h.github && !h.github.done)
    .map(([id, h]) => ({ id, ...h }));
}

/**
 * Record a resolution for one or more items. Input: `{ items: [ids],
 * resolution, class, decision, rationale, risk?, source?, alternatives?,
 * files?, commit?, refs?, reply?, discovered_item? }`.
 */
export function cmdRecord(ctx, input) {
  const { statePath, env, runDir, config } = ctx;
  const ids = [input.items ?? input.item].flat().filter(Boolean).map(String);
  if (ids.length === 0) throw new FixReviewError("record: `items` must list at least one item ID", 2);
  if (!RESOLUTIONS.includes(input.resolution))
    throw new FixReviewError(`record: resolution must be one of ${RESOLUTIONS.join(", ")}`, 2);
  if (!CLASSES.includes(input.class)) throw new FixReviewError(`record: class must be one of ${CLASSES.join(", ")}`, 2);
  if (!RESOLUTION_CLASSES[input.resolution].includes(input.class))
    throw new FixReviewError(`record: class ${input.class} cannot be resolved as ${input.resolution}`, 2);
  if (!input.decision || !input.rationale)
    throw new FixReviewError("record: `decision` and `rationale` are required", 2);
  const fr = config["fix-review"] ?? {};
  const risk = input.risk ?? (input.class === "B-Decide" ? "medium" : DEFAULT_RISK[input.resolution]);
  return updateState(statePath, env, (state) => {
    const unknown = ids.filter((id) => !state.items[id]);
    if (unknown.length > 0 && statePath)
      throw new FixReviewError(`record: unknown item ${unknown.join(", ")} (run fetch, internal or checks first)`, 2);
    const refs = [
      ...new Set([...ids.map((id) => state.items[id]?.url ?? id), ...(input.refs ?? [])].filter(Boolean))
    ];
    let decision = null;
    if (runDir) {
      const rationale = input.rationale.startsWith(input.class) ? input.rationale : `${input.class}: ${input.rationale}`;
      const entry = {
        phase: "fix-review",
        source: input.source ?? (input.resolution === "deferred" ? "policy" : "agent"),
        risk,
        decision: input.decision,
        rationale,
        refs,
        "x-esp-class": input.class
      };
      for (const key of ["alternatives", "files"]) if (input[key]?.length) entry[key] = input[key];
      if (input.commit) entry.commit = input.commit;
      decision = appendDecision(runDir, entry, env);
    }
    const round = state.rounds.at(-1)?.n ?? 0;
    const at = now(env).toISOString();
    for (const id of ids) {
      const actions = githubActions(state.items[id], input.resolution, {
        reply: input.reply,
        replyToRejected: fr.reply_to_rejected !== false,
        deferredItems: fr.deferred_items ?? "follow-up"
      });
      const owed = actions.reply || actions.resolve || actions.minimize;
      state.handled[id] = {
        round,
        at,
        resolution: input.resolution,
        class: input.class,
        risk,
        decision: input.decision,
        decision_id: decision?.id ?? null,
        commit: input.commit ?? null,
        reply: actions.reply ? input.reply : null,
        discovered_item: input.discovered_item ?? null,
        github: owed ? { ...actions, done: false, reply_url: null, errors: [] } : null
      };
    }
    return { recorded: ids, resolution: input.resolution, decision_id: decision?.id ?? null, risk };
  });
}

/** Post the replies and resolve the threads owed by recorded items. */
export function cmdRespond(ctx) {
  const { statePath, env, client } = ctx;
  if (!statePath) throw new FixReviewError("respond needs --run-dir or --state", 2);
  return updateState(statePath, env, (state) => {
    if (state.mode !== "pr") return { responded: [], failed: [], note: "not a pull request fix-review" };
    const responded = [];
    const failed = [];
    for (const h of pendingGithub(state)) {
      const item = state.items[h.id];
      const entry = state.handled[h.id];
      const g = entry.github;
      g.errors = [];
      try {
        if (g.reply && !g.reply_url) {
          g.reply_url =
            item.kind === "inline"
              ? client.replyInline(state.repo, state.pr, item.in_reply_to ?? item.comment_id, entry.reply)
              : client.comment(state.repo, state.pr, quoteReply(item, entry.reply));
          g.reply_url = g.reply_url ?? "posted";
        }
        if (g.resolve && !g.resolved) {
          client.resolveThread(item.thread_id);
          g.resolved = true;
        }
        if (g.minimize && !g.minimized) {
          client.minimize(item.node_id);
          g.minimized = true;
        }
        g.done = true;
        responded.push({ id: h.id, reply_url: g.reply_url, resolved: Boolean(g.resolved), minimized: Boolean(g.minimized) });
      } catch (err) {
        g.errors.push(err.message);
        failed.push({ id: h.id, error: err.message });
      }
    }
    return { responded, failed };
  });
}

/** A reply to a review body or issue comment, which GitHub cannot thread. */
export function quoteReply(item, text) {
  const line = item.excerpt ?? excerpt(item.body ?? item.title);
  const quote = line ? `> ${line}\n\n` : "";
  const link = item.url ? `(re: ${item.url})\n\n` : "";
  return `${quote}${link}${text}`;
}

function countResolutions(handled) {
  const counts = Object.fromEntries(RESOLUTIONS.map((r) => [r, 0]));
  for (const h of handled) counts[h.resolution]++;
  return counts;
}

/**
 * Build the result block from the state. Options: `remaining` (unhandled
 * items left when the loop stopped), `status`, `summary`, `pr`, `haltOn`.
 */
export function buildResult(state, { remaining = 0, status, summary, haltOn = [], statePath = null, runDir = null } = {}) {
  const entries = Object.entries(state.handled).map(([id, h]) => ({ id, ...h }));
  const items = entries.filter((h) => !h.id.startsWith("check:"));
  const checks = entries.filter((h) => h.id.startsWith("check:"));
  const counts = countResolutions(items);
  const commits = [...new Set(entries.map((h) => h.commit).filter(Boolean))];
  const exhausted = state.max_rounds != null && state.rounds.length >= state.max_rounds;
  let risk = "low";
  for (const h of entries) risk = maxRisk(risk, h.risk ?? "low");
  const discovered = entries
    .filter((h) => h.resolution === "deferred")
    .map((h) => {
      const base = h.discovered_item ?? { type: "follow-up", title: h.decision };
      const meta = state.items[h.id] ?? {};
      return {
        type: base.type ?? "follow-up",
        title: base.title ?? h.decision,
        evidence: base.evidence ?? meta.url ?? meta.location ?? h.id,
        ...(base.severity ? { severity: base.severity } : {}),
        ...(base.files?.length ? { files: base.files } : {})
      };
    });
  let resolvedStatus = status;
  let reason = null;
  if (!resolvedStatus) {
    if (remaining > 0 && exhausted) {
      if (haltOn.includes("budget")) {
        resolvedStatus = "halted";
        reason = "budget";
      } else {
        resolvedStatus = "done";
        discovered.push({
          type: "follow-up",
          title: `${remaining} review item${remaining === 1 ? "" : "s"} left after ${state.max_rounds} fix round${state.max_rounds === 1 ? "" : "s"}`,
          evidence: state.url ?? "fix-review rounds exhausted"
        });
      }
    } else if (counts.open > 0) resolvedStatus = "awaiting-human";
    else resolvedStatus = "done";
  }
  if (resolvedStatus === "halted") risk = "high";
  const pendingGh = pendingGithub(state).length;
  const parts = [
    `${counts.fixed} fixed`,
    `${counts.rejected} rejected`,
    `${counts.deferred} deferred`,
    ...(counts.open ? [`${counts.open} open`] : []),
    ...(checks.length ? [`${checks.filter((c) => c.resolution === "fixed").length} CI fixes`] : [])
  ];
  const where = state.mode === "pr" ? `PR ${state.pr}` : "the internal review";
  const text =
    summary ??
    (reason === "budget"
      ? `Halted on ${where}: ${remaining} items left after ${state.max_rounds} rounds (${parts.join(", ")}).`
      : `Fix-review of ${where} over ${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"}: ${parts.join(", ")}.`);
  const block = {
    contract_version: 1,
    status: resolvedStatus,
    summary: text,
    max_risk: risk,
    ...(commits.length ? { commit: commits.at(-1) } : {}),
    ...(state.url ? { pr: state.url } : {}),
    outputs: {
      mode: state.mode,
      pr: state.pr,
      rounds: state.rounds.length,
      max_rounds: state.max_rounds,
      exhausted,
      remaining,
      ...counts,
      ci_fixed: checks.filter((c) => c.resolution === "fixed").length,
      commits,
      pending_github: pendingGh,
      state_path: statePath
    }
  };
  if (discovered.length) block.discovered_items = discovered;
  if (resolvedStatus === "awaiting-human" && counts.open > 0 && runDir) {
    const open = items.filter((h) => h.resolution === "open");
    block.needs_input = {
      id: "fix-review-open",
      question: `${open.length} review item${open.length === 1 ? "" : "s"} need${open.length === 1 ? "s" : ""} a decision: ${open
        .map((h) => h.decision)
        .join("; ")}`.slice(0, 1000),
      options: [],
      recommended: null,
      context: open.map((h) => state.items[h.id]?.url ?? h.id).join(", "),
      blocking: true
    };
  }
  const check = validateArtifact("result", block);
  if (!check.valid)
    throw new FixReviewError(`Invalid result block:\n${check.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  return block;
}

/** Log the budget halt that buildResult decided. */
function logBudgetHalt(runDir, state, remaining, env) {
  appendDecision(
      runDir,
      {
        phase: "fix-review",
        source: "policy",
        risk: "high",
        decision: `Stopped fix-review with ${remaining} items left`,
        rationale: `Halt: budget, ${state.max_rounds} fix rounds used`,
        refs: state.url ? [state.url] : [],
        "x-esp-class": "Halt"
      },
      env
    );
}

export function cmdResult(ctx, options) {
  const { statePath, env, runDir, config } = ctx;
  if (!statePath) throw new FixReviewError("result needs --run-dir or --state", 2);
  const state = readState(statePath, env);
  const remaining = options.remaining !== undefined ? Number(options.remaining) : 0;
  if (!Number.isInteger(remaining) || remaining < 0) throw new FixReviewError("--remaining must be an integer >= 0", 2);
  const block = buildResult(state, {
    remaining,
    status: options.status,
    summary: options.summary,
    haltOn: config.go?.halt_on ?? [],
    statePath,
    runDir
  });
  if (runDir && !options.status && block.status === "halted") logBudgetHalt(runDir, state, remaining, env);
  return block;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: fix-review.mjs <command> [args] [options]

Commands:
  fetch [pr]              Fetch unhandled review items of a pull request
  internal [findings]     Load unhandled findings from an esp-review findings file
                          (default: the latest review-<N>.json of --run-dir)
  checks [pr]             Summarize CI checks of the pull request head
  round                   Start the next fix round (exhausted: true when none is left)
  record                  Record a resolution (--json <object> or stdin)
  respond                 Post owed replies, resolve threads, minimize comments
  result                  Print the contract result block

Options:
  --run-dir <path>        Run directory: state in <run-dir>/fix-review.json, decisions logged
  --state <file>          State file without a run directory
  --reviewers <a,b>       Only items from these reviewers (names from await-review.reviewers, or logins)
  --max-rounds <n>        Round limit (default: fix-review.max_rounds)
  --include-handled       Also return items already handled
  --remaining <n>         result: unhandled items left when the loop stopped
  --status <status>       result: override the status
  --summary <text>        result: override the summary
  --json <object>         record: the resolution
  --config-snapshot <p>   Config snapshot
  --project-dir <dir>     Repository root (default: nearest git root)

Environment:
  ESP_GH_CMD              JSON array replacing the gh command (tests)`;

const BOOLEAN_OPTIONS = new Set(["include-handled", "help"]);

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
      if (value === undefined) throw new FixReviewError(`--${key} requires a value`, 2);
      options[key] = value;
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

function readInput(options) {
  let raw = options.json;
  if (raw === undefined) {
    try {
      raw = readFileSync(0, "utf8");
    } catch {
      raw = undefined;
    }
  }
  if (raw === undefined || String(raw).trim() === "") throw new FixReviewError("record requires --json <object> or JSON on stdin", 2);
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected a JSON object");
    return value;
  } catch (err) {
    throw new FixReviewError(`record: invalid JSON input (${err.message})`, 2);
  }
}

/** Shared context: config, state path, reviewers, client. */
export function buildContext(options, env = process.env, io = {}) {
  const projectDir = resolve(options["project-dir"] ?? findRepoRoot(process.cwd()) ?? process.cwd());
  let config;
  try {
    ({ config } = loadConfig({ projectDir, snapshot: options["config-snapshot"], env }));
  } catch (err) {
    if (err instanceof ConfigError) throw new FixReviewError(err.message, err.exitCode ?? 1);
    throw err;
  }
  const runDir = options["run-dir"] ? resolve(expandHome(options["run-dir"])) : null;
  if (runDir && !existsSync(join(runDir, "run.json"))) throw new FixReviewError(`Not a run directory (no run.json): ${runDir}`, 2);
  const statePath = options.state ? resolve(expandHome(options.state)) : runDir ? join(runDir, "fix-review.json") : null;
  const fr = config["fix-review"] ?? {};
  const maxRounds = options["max-rounds"] !== undefined ? Number(options["max-rounds"]) : fr.max_rounds ?? 3;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new FixReviewError("--max-rounds must be an integer >= 1", 2);
  const reviewers = options.reviewers
    ? resolveReviewers(options.reviewers, config["await-review"]?.reviewers ?? {})
    : [];
  return {
    config,
    projectDir,
    runDir,
    statePath,
    maxRounds,
    reviewers,
    includeHandled: Boolean(options["include-handled"]),
    env,
    get client() {
      return io.client ?? ghClient({ cwd: projectDir, env });
    }
  };
}

export function run(argv, env = process.env, io = {}) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command) return { output: USAGE, exitCode: command ? 0 : 2 };
  const ctx = buildContext(options, env, io);
  const target = () => prArgument(args.join(" "));
  switch (command) {
    case "fetch":
      return { output: cmdFetch(ctx, target()) };
    case "internal":
      return { output: cmdInternal(ctx, args[0]) };
    case "checks":
      return { output: cmdChecks(ctx, target()) };
    case "round":
      if (!ctx.statePath) throw new FixReviewError("round needs --run-dir or --state", 2);
      return { output: cmdRound(ctx) };
    case "record":
      return { output: cmdRecord(ctx, readInput(options)) };
    case "respond": {
      const out = cmdRespond(ctx);
      return { output: out, exitCode: out.failed.length ? 1 : 0 };
    }
    case "result": {
      const block = cmdResult(ctx, options);
      return { output: JSON.stringify(block), exitCode: exitCodeFor(block.status) };
    }
    default:
      throw new FixReviewError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    process.stdout.write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = err instanceof FixReviewError || err.name === "WaitError" || err.name === "RunsError";
    process.stderr.write(`fix-review error: ${known ? err.message : (err.stack ?? err)}\n`);
    process.exitCode = known ? (err.exitCode ?? 1) : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
