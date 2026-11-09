#!/usr/bin/env node
// esp-skills merge gate for esp-merge.
//
// Decides whether a pull request may merge, under objective conditions only,
// and with which method the repository allows. The model never decides that a
// pull request is mergeable: it runs this script, and acts on its outcome
// (rebase when behind, wait when checks are pending, stop otherwise).
//
// Commands:
//   check [pr]   Evaluate every merge condition, print the report
//   method [pr]  Resolve the merge method, print it
//   merge [pr]   Under the merge lock: check again, merge, clean up, log the
//                decision, print a contract result block
//
// Exit codes: check and method exit 0 when they ran (read `ready` / `method`).
// merge exits with the contract code of its result status (0 done or merged,
// 10 awaiting-human, 20 halted, 1 failed). 2 is a usage error everywhere.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync
} from "node:fs";
import { hostname } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  expandHome,
  findRepoRoot,
  loadConfig
} from "./config.mjs";
import { exitCodeFor, validateArtifact } from "./lib/contract.mjs";
import { appendDecision, appendEvent } from "./runs.mjs";
import { prArgument, repoFromUrl } from "./wait-for-review.mjs";

export class MergeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "MergeError";
    this.exitCode = exitCode;
  }
}

export const METHODS = ["squash", "rebase", "merge"];
export const CONDITIONS = [
  "open",
  "halt",
  "draft",
  "changes-requested",
  "threads",
  "checks",
  "up-to-date",
  "branch-protection"
];
const SHORT_SHA = 7;
const STALE_LOCK_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const HALTED_RUN_STATUSES = new Set(["halted", "failed", "canceled"]);

// ---------------------------------------------------------------------------
// gh client
// ---------------------------------------------------------------------------

function parseJsonLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

const SETTINGS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed deleteBranchOnMerge
    pullRequest(number: $number) { isMergeQueueEnabled isInMergeQueue }
  }
}`;

const PROTECTION_QUERY = `query($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) { branchProtectionRule { requiresLinearHistory } }
  }
}`;

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved comments(first: 1) { nodes { url } } }
      }
    }
  }
}`;

const PR_FIELDS = [
  "number",
  "url",
  "state",
  "isDraft",
  "headRefOid",
  "headRefName",
  "baseRefName",
  "isCrossRepository",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "latestReviews",
  "autoMergeRequest"
].join(",");

/** A `gh`-backed client. `ESP_GH_CMD` (a JSON array) replaces `gh`, for tests. */
export function ghClient({ cwd, env = process.env } = {}) {
  const prefix = env.ESP_GH_CMD ? JSON.parse(env.ESP_GH_CMD) : ["gh"];
  const call = (args) => {
    const res = spawnSync(prefix[0], [...prefix.slice(1), ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    if (res.error)
      throw new MergeError(`gh could not run: ${res.error.message}`);
    return res;
  };
  const gh = (args, { okStatuses = [0] } = {}) => {
    const res = call(args);
    if (!okStatuses.includes(res.status))
      throw new MergeError(
        `gh ${args.slice(0, 3).join(" ")} failed: ${(res.stderr || res.stdout).trim()}`
      );
    return res.stdout;
  };
  const graphql = (query, vars, jq) => {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(vars))
      args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
    if (jq) args.push("--jq", jq);
    return gh(args);
  };
  return {
    pr(target) {
      const args = ["pr", "view"];
      if (target) args.push(String(target));
      args.push("--json", PR_FIELDS);
      const pr = JSON.parse(gh(args));
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        draft: Boolean(pr.isDraft),
        head: pr.headRefOid,
        branch: pr.headRefName,
        base: pr.baseRefName,
        cross_repository: Boolean(pr.isCrossRepository),
        mergeable: pr.mergeable ?? "UNKNOWN",
        merge_state: pr.mergeStateStatus ?? "UNKNOWN",
        review_decision: pr.reviewDecision || null,
        latest_reviews: (pr.latestReviews ?? []).map((r) => ({
          login: r.author?.login ?? null,
          state: r.state
        })),
        auto_merge: Boolean(pr.autoMergeRequest)
      };
    },
    checks(number, { required = false } = {}) {
      // gh pr checks exits 8 while checks are pending and 1 when one failed.
      const args = [
        "pr",
        "checks",
        String(number),
        "--json",
        "name,state,bucket,link,workflow"
      ];
      if (required) args.push("--required");
      const res = call(args);
      const out = res.stdout.trim();
      if (out.startsWith("[")) return JSON.parse(out);
      const text = `${res.stderr}\n${res.stdout}`;
      if (/no (required )?checks reported/i.test(text)) return [];
      if (res.status === 0 && out === "") return [];
      throw new MergeError(`gh pr checks failed: ${text.trim()}`);
    },
    unresolvedThreads(repo, number) {
      const [owner, name] = repo.split("/");
      const args = [
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
        ".data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | {url: .comments.nodes[0].url}"
      ];
      return parseJsonLines(gh(args)).map((t) => t.url ?? null);
    },
    compare(repo, base, head) {
      const out = gh([
        "api",
        `repos/${repo}/compare/${encodeURIComponent(base)}...${head}`,
        "--jq",
        "{status, ahead_by, behind_by}"
      ]);
      return JSON.parse(out);
    },
    settings(repo, number) {
      const [owner, name] = repo.split("/");
      const out = graphql(
        SETTINGS_QUERY,
        { owner, name, number: Number(number) },
        ".data.repository"
      );
      const data = JSON.parse(out);
      return {
        squash: Boolean(data.squashMergeAllowed),
        rebase: Boolean(data.rebaseMergeAllowed),
        merge: Boolean(data.mergeCommitAllowed),
        delete_branch_on_merge: Boolean(data.deleteBranchOnMerge),
        merge_queue: Boolean(data.pullRequest?.isMergeQueueEnabled),
        in_merge_queue: Boolean(data.pullRequest?.isInMergeQueue)
      };
    },
    rules(repo, branch) {
      const res = call([
        "api",
        "--paginate",
        `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`,
        "--jq",
        ".[] | {type, parameters}"
      ]);
      if (res.status !== 0) {
        if (/HTTP 404|Not Found/i.test(`${res.stderr}${res.stdout}`)) return [];
        throw new MergeError(
          `gh api rules failed: ${(res.stderr || res.stdout).trim()}`
        );
      }
      return parseJsonLines(res.stdout);
    },
    protection(repo, branch) {
      // Classic branch protection is only readable with enough permission: null when unknown.
      const [owner, name] = repo.split("/");
      try {
        const out = graphql(
          PROTECTION_QUERY,
          { owner, name, ref: `refs/heads/${branch}` },
          ".data.repository.ref.branchProtectionRule"
        );
        const rule =
          out.trim() === "" || out.trim() === "null" ? null : JSON.parse(out);
        return rule
          ? { linear_history: Boolean(rule.requiresLinearHistory) }
          : { linear_history: false };
      } catch {
        return null;
      }
    },
    merge(number, { method, head, auto = false }) {
      const args = ["pr", "merge", String(number), `--${method}`];
      if (head) args.push("--match-head-commit", head);
      if (auto) args.push("--auto");
      return gh(args).trim();
    },
    deleteBranch(repo, branch) {
      const res = call([
        "api",
        "-X",
        "DELETE",
        `repos/${repo}/git/refs/heads/${branch}`
      ]);
      if (res.status === 0) return "deleted";
      if (
        /Reference does not exist|HTTP 422|HTTP 404/i.test(
          `${res.stderr}${res.stdout}`
        )
      )
        return "already-deleted";
      throw new MergeError(
        `Deleting branch ${branch} failed: ${(res.stderr || res.stdout).trim()}`
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Method resolution
// ---------------------------------------------------------------------------

const QUEUE_METHODS = { MERGE: "merge", SQUASH: "squash", REBASE: "rebase" };

/** Combine repository settings, rulesets and classic protection into one policy. */
export function mergePolicy(settings, rules = [], protection = null) {
  let allowed = METHODS.filter((m) => settings[m]);
  const rulesetMethods = rules
    .filter(
      (r) =>
        r.type === "pull_request" &&
        Array.isArray(r.parameters?.allowed_merge_methods)
    )
    .map((r) =>
      r.parameters.allowed_merge_methods.map((m) => String(m).toLowerCase())
    );
  for (const methods of rulesetMethods)
    allowed = allowed.filter((m) => methods.includes(m));
  const queueRule = rules.find((r) => r.type === "merge_queue");
  const linearHistory =
    rules.some((r) => r.type === "required_linear_history") ||
    Boolean(protection?.linear_history);
  return {
    allowed,
    linear_history: linearHistory,
    linear_history_known:
      protection !== null ||
      rules.some((r) => r.type === "required_linear_history"),
    merge_queue: Boolean(settings.merge_queue || queueRule),
    queue_method: QUEUE_METHODS[queueRule?.parameters?.merge_method] ?? null,
    delete_branch_on_merge: Boolean(settings.delete_branch_on_merge)
  };
}

/**
 * Resolve the merge method (plan rules 2-5). `method` is `repo` or an explicit
 * method. Returns `{ method, queue, allowed, reason, alternatives }`. An explicit
 * method the repository does not allow is an error, never a silent fallback.
 */
export function resolveMethod(
  policy,
  { method = "repo", preference = METHODS } = {}
) {
  const usable = policy.allowed.filter(
    (m) => !(policy.linear_history && m === "merge")
  );
  const excluded =
    policy.linear_history && policy.allowed.includes("merge")
      ? " (merge commits excluded: linear history required)"
      : "";
  if (method && method !== "repo") {
    if (!METHODS.includes(method))
      throw new MergeError(`Unknown merge method: ${method}`, 2);
    if (!usable.includes(method)) {
      const why = policy.allowed.includes(method)
        ? "linear history is required"
        : "the repository does not allow it";
      throw new MergeError(
        `Merge method ${method} is not allowed: ${why}. Allowed: ${usable.join(", ") || "none"}`
      );
    }
    return {
      method,
      queue: policy.merge_queue,
      allowed: usable,
      reason: policy.merge_queue
        ? `explicit method ${method}, then the merge queue decides`
        : `explicit method ${method} (merge.method or --method)`,
      alternatives: usable.filter((m) => m !== method)
    };
  }
  if (usable.length === 0)
    throw new MergeError(
      `No merge method is allowed on this repository${excluded}`
    );
  if (policy.merge_queue) {
    const chosen =
      policy.queue_method && usable.includes(policy.queue_method)
        ? policy.queue_method
        : firstPreferred(usable, preference);
    return {
      method: chosen,
      queue: true,
      allowed: usable,
      reason: `merge queue enabled on the base branch: enqueue, the queue decides${policy.queue_method ? ` (queue method ${policy.queue_method})` : ""}`,
      alternatives: []
    };
  }
  if (usable.length === 1) {
    return {
      method: usable[0],
      queue: false,
      allowed: usable,
      reason: `only method allowed${excluded}`,
      alternatives: []
    };
  }
  const chosen = firstPreferred(usable, preference);
  return {
    method: chosen,
    queue: false,
    allowed: usable,
    reason: `first allowed method in merge.preference [${preference.join(", ")}]${excluded}`,
    alternatives: usable.filter((m) => m !== chosen)
  };
}

function firstPreferred(usable, preference) {
  return preference.find((m) => usable.includes(m)) ?? usable[0];
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Read halt signals from a run directory: the run status, and Halt decisions
 * that no later operator decision references (an operator decision whose
 * `refs` names the Halt decision ID lifts it).
 */
export function haltSignals(runDir) {
  if (!runDir) return { known: false, reasons: [] };
  const reasons = [];
  const runPath = join(runDir, "run.json");
  if (existsSync(runPath)) {
    const run = JSON.parse(readFileSync(runPath, "utf8"));
    if (HALTED_RUN_STATUSES.has(run.status))
      reasons.push(`run status is ${run.status}`);
  }
  const decisionsPath = join(runDir, "decisions.jsonl");
  if (existsSync(decisionsPath)) {
    const decisions = parseJsonLines(readFileSync(decisionsPath, "utf8"));
    const lifted = new Set(
      decisions
        .filter((d) => d.source === "operator")
        .flatMap((d) => d.refs ?? [])
    );
    for (const d of decisions) {
      if (d["x-esp-class"] === "Halt" && !lifted.has(d.id))
        reasons.push(`${d.id}: ${d.decision}`);
    }
  }
  return { known: true, reasons };
}

function condition(name, status, reason, extra = {}) {
  return { name, status, reason, ...extra };
}

/** Classify checks: `{ failing, pending, passing }` names within the scope. */
export function classifyChecks(
  all = [],
  required = null,
  { requireGreen = true } = {}
) {
  const requiredNames = new Set((required ?? []).map((c) => c.name));
  const scope = requireGreen
    ? all
    : all.filter((c) => requiredNames.has(c.name));
  const out = {
    failing: [],
    pending: [],
    passing: [],
    scope: requireGreen ? "all" : "required"
  };
  for (const check of scope) {
    const bucket = String(check.bucket ?? "").toLowerCase();
    if (bucket === "fail" || bucket === "cancel") out.failing.push(check.name);
    else if (bucket === "pending") out.pending.push(check.name);
    else out.passing.push(check.name);
  }
  // Required checks that have not reported yet are pending.
  if (required) {
    const seen = new Set(scope.map((c) => c.name));
    for (const check of required)
      if (!seen.has(check.name)) out.pending.push(check.name);
  }
  return out;
}

/**
 * Evaluate every merge condition from the gathered facts. Returns
 * `{ ready, outcome, conditions }`. Conditions are `pass`, `fail` or
 * `pending`. Outcomes, by precedence: `closed`, `merged`, `halted`, `blocked`
 * (a condition only a human or another skill can fix), `conflict`, `behind`
 * (rebase and re-check), `pending` (checks running), `protected` (branch
 * protection unmet, never bypassed), `queued` (already in the merge queue),
 * `ready`.
 */
export function evaluate(facts, config = {}) {
  const { pr, checks, threads, compare, halt, policy } = facts;
  const conditions = [];

  if (pr.state === "MERGED")
    conditions.push(condition("open", "fail", "already merged"));
  else if (pr.state !== "OPEN")
    conditions.push(
      condition(
        "open",
        "fail",
        `pull request is ${String(pr.state).toLowerCase()}`
      )
    );
  else conditions.push(condition("open", "pass", "open"));

  if (!halt?.known)
    conditions.push(
      condition("halt", "pass", "no run directory, no halt recorded")
    );
  else if (halt.reasons.length > 0)
    conditions.push(
      condition("halt", "fail", `halt recorded: ${halt.reasons.join("; ")}`)
    );
  else conditions.push(condition("halt", "pass", "no halt in the run"));

  conditions.push(
    pr.draft
      ? condition("draft", "fail", "pull request is a draft")
      : condition("draft", "pass", "ready for review")
  );

  const requesting = (pr.latest_reviews ?? [])
    .filter((r) => r.state === "CHANGES_REQUESTED")
    .map((r) => r.login);
  if (requesting.length > 0 || pr.review_decision === "CHANGES_REQUESTED") {
    conditions.push(
      condition(
        "changes-requested",
        "fail",
        `changes requested${requesting.length ? ` by ${requesting.join(", ")}` : ""}`,
        { reviewers: requesting }
      )
    );
  } else
    conditions.push(
      condition("changes-requested", "pass", "no changes requested")
    );

  if (config.require_resolved_threads === false)
    conditions.push(
      condition(
        "threads",
        "pass",
        "not required (merge.require_resolved_threads)"
      )
    );
  else if (threads.length > 0)
    conditions.push(
      condition(
        "threads",
        "fail",
        `${threads.length} unresolved review thread(s)`,
        { threads }
      )
    );
  else
    conditions.push(
      condition("threads", "pass", "all review threads resolved")
    );

  const scopeLabel = checks.scope === "all" ? "checks" : "required checks";
  if (checks.failing.length > 0) {
    conditions.push(
      condition(
        "checks",
        "fail",
        `failing ${scopeLabel}: ${checks.failing.join(", ")}`,
        { failing: checks.failing, pending: checks.pending }
      )
    );
  } else if (checks.pending.length > 0) {
    conditions.push(
      condition(
        "checks",
        "pending",
        `pending ${scopeLabel}: ${checks.pending.join(", ")}`,
        { pending: checks.pending }
      )
    );
  } else {
    conditions.push(
      condition(
        "checks",
        "pass",
        checks.passing.length
          ? `${checks.passing.length} ${scopeLabel} green`
          : `no ${scopeLabel}`
      )
    );
  }

  if (policy.merge_queue)
    conditions.push(
      condition("up-to-date", "pass", "merge queue keeps the branch up to date")
    );
  else if (pr.mergeable === "CONFLICTING" || pr.merge_state === "DIRTY") {
    conditions.push(
      condition(
        "up-to-date",
        "fail",
        `conflicts with ${pr.base}: rebase needed`,
        { conflict: true, behind_by: compare?.behind_by ?? null }
      )
    );
  } else if ((compare?.behind_by ?? 0) > 0 || pr.merge_state === "BEHIND") {
    conditions.push(
      condition(
        "up-to-date",
        "fail",
        `behind ${pr.base} by ${compare?.behind_by ?? "some"} commit(s): rebase and re-check`,
        { conflict: false, behind_by: compare?.behind_by ?? null }
      )
    );
  } else
    conditions.push(
      condition("up-to-date", "pass", `up to date with ${pr.base}`)
    );

  const others = conditions.filter((c) => c.name !== "branch-protection");
  const clean = others.every((c) => c.status === "pass");
  if (pr.state !== "OPEN") {
    conditions.push(
      condition(
        "branch-protection",
        "pass",
        "not evaluated: the pull request is not open"
      )
    );
  } else if (pr.review_decision === "REVIEW_REQUIRED") {
    conditions.push(
      condition(
        "branch-protection",
        "fail",
        "an approving review is required by branch protection"
      )
    );
  } else if (clean && pr.merge_state === "BLOCKED" && !policy.merge_queue) {
    conditions.push(
      condition(
        "branch-protection",
        "fail",
        "branch protection or rulesets block the merge (mergeStateStatus BLOCKED)"
      )
    );
  } else
    conditions.push(
      condition(
        "branch-protection",
        "pass",
        clean
          ? "no unmet protection rule reported"
          : "re-checked once the other conditions pass"
      )
    );

  const failed = (name) =>
    conditions.find((c) => c.name === name)?.status === "fail";
  let outcome;
  if (pr.state === "MERGED") outcome = "merged";
  else if (pr.state !== "OPEN") outcome = "closed";
  else if (failed("halt")) outcome = "halted";
  else if (["draft", "changes-requested", "threads", "checks"].some(failed))
    outcome = "blocked";
  else if (failed("up-to-date"))
    outcome = conditions.find((c) => c.name === "up-to-date").conflict
      ? "conflict"
      : "behind";
  else if (conditions.some((c) => c.status === "pending")) outcome = "pending";
  else if (failed("branch-protection")) outcome = "protected";
  else if (policy.in_merge_queue || pr.auto_merge) outcome = "queued";
  else outcome = "ready";
  return { ready: outcome === "ready", outcome, conditions };
}

// ---------------------------------------------------------------------------
// Gathering facts
// ---------------------------------------------------------------------------

/** Read everything the conditions and the method need, through the client. */
export function gather(ctx, target) {
  const { client, config, runDir } = ctx;
  const merge = config.merge ?? {};
  const pr = client.pr(target);
  const repo = repoFromUrl(pr.url);
  const settings = client.settings(repo, pr.number);
  const rules = client.rules(repo, pr.base);
  const protection = client.protection(repo, pr.base);
  const policy = {
    ...mergePolicy(settings, rules, protection),
    in_merge_queue: settings.in_merge_queue
  };
  const open = pr.state === "OPEN";
  const all = open ? client.checks(pr.number) : [];
  const required = open ? client.checks(pr.number, { required: true }) : [];
  const checks = classifyChecks(all, required, {
    requireGreen: merge.require_green_checks !== false
  });
  const threads =
    open && merge.require_resolved_threads !== false
      ? client.unresolvedThreads(repo, pr.number)
      : [];
  const compare =
    open && !policy.merge_queue ? client.compare(repo, pr.base, pr.head) : null;
  const halt = haltSignals(runDir);
  return { repo, pr, policy, checks, threads, compare, halt };
}

function shortHead(sha) {
  return String(sha ?? "").slice(0, SHORT_SHA);
}

/** The `check` report: facts, conditions, outcome and the resolved method. */
export function report(ctx, target) {
  const facts = gather(ctx, target);
  const merge = ctx.config.merge ?? {};
  const evaluation = evaluate(facts, merge);
  let method;
  try {
    method = resolveMethod(facts.policy, {
      method: ctx.method ?? merge.method ?? "repo",
      preference: merge.preference ?? METHODS
    });
  } catch (err) {
    if (!(err instanceof MergeError) || err.exitCode === 2) throw err;
    method = { method: null, error: err.message };
  }
  return {
    pr: facts.pr.number,
    url: facts.pr.url,
    repo: facts.repo,
    head: facts.pr.head,
    branch: facts.pr.branch,
    base: facts.pr.base,
    cross_repository: facts.pr.cross_repository,
    ready: evaluation.ready && Boolean(method.method),
    outcome:
      evaluation.ready && !method.method ? "blocked" : evaluation.outcome,
    conditions: evaluation.conditions,
    method,
    policy: facts.policy,
    enabled: merge.enabled !== false,
    auto_merge: Boolean(merge.use_auto_merge)
  };
}

/** `check --wait`: poll while the only obstacle is pending checks. */
export async function waitForChecks(
  ctx,
  target,
  { timeoutMinutes, pollSeconds = 30 }
) {
  const { sleep, now = () => new Date(), log = () => {} } = ctx;
  const deadline = now().getTime() + timeoutMinutes * 60_000;
  let polls = 0;
  for (;;) {
    polls += 1;
    const out = report(ctx, target);
    out.polls = polls;
    if (out.outcome !== "pending") return out;
    const remaining = deadline - now().getTime();
    if (remaining <= 0) {
      out.timed_out = true;
      return out;
    }
    const pending =
      out.conditions.find((c) => c.name === "checks")?.pending ?? [];
    log(
      `poll ${polls}: waiting for ${pending.join(", ") || "checks"} on ${shortHead(out.head)}`
    );
    await sleep(Math.min(pollSeconds * 1000, remaining));
  }
}

// ---------------------------------------------------------------------------
// Merge lock (AF_MERGE_LOCK)
// ---------------------------------------------------------------------------

/**
 * Acquire the harness merge lock: exclusive create of `lockPath`, the contract
 * lock protocol (a lock older than 30 s is stale). The holder refreshes the
 * mtime every 10 s and before each GitHub call, so a long merge never looks
 * stale. Returns `{ path, refresh(), release() }`.
 */
export async function acquireMergeLock(
  lockPath,
  {
    timeoutMs,
    sleep,
    now = () => new Date(),
    staleMs = STALE_LOCK_MS,
    holder = {}
  }
) {
  const deadline = now().getTime() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          host: hostname(),
          at: now().toISOString(),
          ...holder
        })
      );
      closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== "EEXIST" && err.code !== "EPERM")
        throw new MergeError(
          `Cannot create merge lock ${lockPath}: ${err.message}`
        );
      try {
        if (now().getTime() - statSync(lockPath).mtimeMs > staleMs) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (now().getTime() >= deadline) return null;
      await sleep(Math.min(2000, Math.max(0, deadline - now().getTime())));
    }
  }
  const refresh = () => {
    try {
      const t = new Date();
      utimesSync(lockPath, t, t);
    } catch {
      // Lost the lock file: nothing to refresh.
    }
  };
  const timer = setInterval(refresh, HEARTBEAT_MS);
  timer.unref?.();
  return {
    path: lockPath,
    refresh,
    release() {
      clearInterval(timer);
      rmSync(lockPath, { force: true });
    }
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function git(args, cwd) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  return res.status === 0 ? res.stdout.trim() : null;
}

function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return (
    rel === "" ||
    (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel))
  );
}

/** Worktree cleanup advice: remove a linked worktree under worktrees.root when cleanup allows it. */
export function worktreeCleanup(projectDir, worktrees = {}) {
  const top = git(["rev-parse", "--show-toplevel"], projectDir);
  const gitDir = git(["rev-parse", "--absolute-git-dir"], projectDir);
  const common = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    projectDir
  );
  if (!top || !gitDir || !common || resolve(gitDir) === resolve(common))
    return { path: null, remove: false, reason: "not a linked worktree" };
  const main = resolve(common, "..");
  const root = worktrees.root ? resolve(expandHome(worktrees.root)) : null;
  const policy = worktrees.cleanup ?? "on-merge";
  if (!root || !isInside(top, root))
    return {
      path: top,
      main,
      remove: false,
      reason: "worktree is not under worktrees.root"
    };
  if (policy === "never")
    return {
      path: top,
      main,
      remove: false,
      reason: "worktrees.cleanup is never"
    };
  return {
    path: top,
    main,
    remove: true,
    reason: `worktrees.cleanup is ${policy}`
  };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const STATUS_BY_OUTCOME = {
  merged: "merged",
  queued: "done",
  "auto-merge": "done",
  disabled: "done",
  "dry-run": "done",
  halted: "halted",
  closed: "failed",
  error: "failed"
};

function needsInput(outcome, reasons) {
  return {
    id: `merge-${outcome}`,
    question: `The pull request cannot merge yet: ${reasons.join("; ")}. Check again after fixing it, or leave it open?`,
    options: [
      {
        id: "retry",
        label: "Check again",
        description: "Run esp-merge again once the condition is met"
      },
      {
        id: "leave-open",
        label: "Leave the pull request open",
        description: "Stop here and merge by hand later"
      }
    ],
    recommended: "retry",
    blocking: true
  };
}

function failingReasons(rep) {
  const reasons = rep.conditions
    .filter((c) => c.status !== "pass")
    .map((c) => c.reason);
  if (rep.method?.error) reasons.push(rep.method.error);
  return reasons;
}

/** Build and validate the merge result block. */
export function buildResult(
  rep,
  {
    outcome,
    summary,
    extra = {},
    runDir = null,
    decision = null,
    cleanup = null,
    blockers = []
  }
) {
  const status = STATUS_BY_OUTCOME[outcome] ?? "awaiting-human";
  const reasons = [...(rep ? failingReasons(rep) : []), ...blockers];
  const block = {
    contract_version: 1,
    status,
    summary,
    max_risk: status === "halted" ? "high" : "low",
    ...(rep?.url ? { pr: rep.url } : {}),
    outputs: {
      pr: rep?.pr ?? null,
      outcome,
      merged: outcome === "merged",
      method: rep?.method?.method ?? null,
      method_reason: rep?.method?.reason ?? rep?.method?.error ?? null,
      queue: Boolean(rep?.method?.queue),
      head: rep?.head ?? null,
      base: rep?.base ?? null,
      conditions: Object.fromEntries(
        (rep?.conditions ?? []).map((c) => [c.name, c.status])
      ),
      failing: reasons,
      decision: decision?.id ?? null,
      cleanup,
      ...extra
    }
  };
  if (status === "awaiting-human" && reasons.length > 0 && runDir)
    block.needs_input = needsInput(outcome, reasons);
  if (status !== "done" && status !== "merged" && reasons.length > 0)
    block.blockers = reasons;
  const check = validateArtifact("result", block);
  if (!check.valid)
    throw new MergeError(
      `Invalid result block:\n${check.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`
    );
  return block;
}

function logDecision(ctx, entry) {
  if (!ctx.runDir) return null;
  return appendDecision(
    ctx.runDir,
    { phase: "merge", source: "policy", ...entry },
    ctx.env
  );
}

function summaryFor(rep, outcome) {
  const pr = rep ? `#${rep.pr}` : "the pull request";
  const head = rep ? ` at ${shortHead(rep.head)}` : "";
  switch (outcome) {
    case "merged":
      return `Merged ${pr}${head} with ${rep.method.method} (${rep.method.reason}).`;
    case "queued":
      return `Added ${pr}${head} to the merge queue (${rep.method.reason}).`;
    case "auto-merge":
      return `Enabled auto-merge (${rep.method.method}) on ${pr}${head}: GitHub merges once the pending checks pass.`;
    case "disabled":
      return `Merge is disabled (merge.enabled false): ${pr} left open.`;
    case "dry-run":
      return `Dry run: ${pr}${head} ${rep.ready ? `is ready, would merge with ${rep.method.method}` : `is not ready (${rep.outcome})`}.`;
    default:
      return `Did not merge ${pr}${head} (${outcome}): ${failingReasons(rep).join("; ") || rep?.method?.error || "not ready"}.`;
  }
}

/**
 * The `merge` command. Holds the merge lock (when `AF_MERGE_LOCK` or `--lock`
 * names one) from the final check to the cleanup, so serialized merges always
 * check against the latest base.
 */
export async function cmdMerge(ctx, target, options = {}) {
  const merge = ctx.config.merge ?? {};

  if (options.halt) {
    const rep = safeReport(ctx, target);
    const decision = logDecision(ctx, {
      risk: "high",
      decision: `Halted the merge of ${rep ? `#${rep.pr}` : "the pull request"}`,
      rationale: `Halt: ${options.halt}`,
      refs: rep?.url ? [rep.url] : [],
      "x-esp-class": "Halt"
    });
    return buildResult(rep, {
      outcome: "halted",
      summary: `Halted, not merged: ${options.halt}.`,
      runDir: ctx.runDir,
      decision,
      blockers: [options.halt]
    });
  }

  if (merge.enabled === false && !options.dryRun) {
    const rep = safeReport(ctx, target);
    return buildResult(rep, {
      outcome: "disabled",
      summary: summaryFor(rep, "disabled"),
      runDir: ctx.runDir
    });
  }

  const lockPath = options.lock ?? ctx.env.AF_MERGE_LOCK ?? null;
  let lock = null;
  if (lockPath && !options.dryRun) {
    lock = await acquireMergeLock(resolve(lockPath), {
      timeoutMs:
        (options.lockTimeoutMinutes ?? merge.checks_timeout_minutes ?? 30) *
        60_000,
      sleep: ctx.sleep,
      now: ctx.now,
      holder: { run: ctx.runDir ?? null }
    });
    if (!lock) {
      const rep = safeReport(ctx, target);
      return buildResult(rep, {
        outcome: "lock-busy",
        summary: `Merge lock ${lockPath} stayed busy: not merged.`,
        runDir: null,
        extra: { lock: lockPath },
        blockers: [`merge lock ${lockPath} busy`]
      });
    }
    if (ctx.runDir)
      appendEvent(ctx.runDir, "merge.locked", { lock: lock.path }, ctx.env);
  }

  try {
    lock?.refresh();
    const rep = report(ctx, target);
    lock?.refresh();
    let outcome = rep.outcome;
    if (options.dryRun) outcome = "dry-run";
    else if (outcome === "pending" && merge.use_auto_merge && rep.method.method)
      outcome = "auto-merge";
    else if (outcome === "ready" && rep.method.queue) outcome = "queued";

    if (rep.outcome === "merged" && !options.dryRun) {
      return buildResult(rep, {
        outcome,
        summary: `#${rep.pr} was already merged.`,
        runDir: ctx.runDir,
        extra: { already_merged: true }
      });
    }
    if (rep.outcome === "queued" && !options.dryRun) {
      return buildResult(rep, {
        outcome: "queued",
        summary: `#${rep.pr} is already ${rep.policy.in_merge_queue ? "in the merge queue" : "set to auto-merge"}.`,
        runDir: ctx.runDir,
        extra: { already_queued: true }
      });
    }
    if (!["ready", "queued", "auto-merge"].includes(outcome)) {
      const decision =
        outcome === "dry-run"
          ? null
          : logDecision(ctx, {
              risk: outcome === "halted" ? "high" : "medium",
              decision: `Did not merge #${rep.pr}: ${outcome}`,
              rationale:
                failingReasons(rep).join("; ") || rep.method.error || outcome,
              refs: [
                rep.url,
                ...(rep.conditions.find((c) => c.name === "threads")?.threads ??
                  [])
              ].filter(Boolean),
              ...(outcome === "halted" ? { "x-esp-class": "Halt" } : {})
            });
      return buildResult(rep, {
        outcome,
        summary: summaryFor(rep, outcome),
        runDir: ctx.runDir,
        decision
      });
    }

    const auto = outcome !== "ready";
    lock?.refresh();
    ctx.client.merge(rep.pr, {
      method: rep.method.method,
      head: rep.head,
      auto
    });
    lock?.refresh();
    if (outcome === "ready") outcome = "merged";

    const decision = logDecision(ctx, {
      risk: "low",
      decision:
        outcome === "merged"
          ? `Merged #${rep.pr} with ${rep.method.method}`
          : outcome === "queued"
            ? `Enqueued #${rep.pr} in the merge queue`
            : `Enabled auto-merge (${rep.method.method}) on #${rep.pr}`,
      rationale: `Method: ${rep.method.reason}. Conditions: ${rep.conditions.map((c) => `${c.name} ${c.status}`).join(", ")}`,
      alternatives: rep.method.alternatives ?? [],
      refs: [rep.url],
      commit: rep.head
    });

    const cleanup = { remote_branch: "kept", worktree: null };
    if (outcome === "merged") {
      if (merge.delete_branch === false)
        cleanup.remote_branch = "kept (merge.delete_branch false)";
      else if (rep.cross_repository)
        cleanup.remote_branch = "kept (fork branch)";
      else if (rep.policy.delete_branch_on_merge)
        cleanup.remote_branch = "deleted by GitHub (delete_branch_on_merge)";
      else {
        try {
          cleanup.remote_branch = ctx.client.deleteBranch(rep.repo, rep.branch);
        } catch (err) {
          if (!(err instanceof MergeError)) throw err;
          cleanup.remote_branch = `failed: ${err.message}`;
        }
      }
      cleanup.worktree = ctx.inspectWorktree ? ctx.inspectWorktree() : null;
    } else {
      cleanup.remote_branch = "pending (GitHub merges later)";
    }
    if (ctx.runDir) {
      appendEvent(
        ctx.runDir,
        "merge.completed",
        {
          pr: rep.pr,
          url: rep.url,
          outcome,
          method: rep.method.method,
          head: rep.head,
          branch_cleanup: cleanup.remote_branch
        },
        ctx.env
      );
    }
    return buildResult(rep, {
      outcome,
      summary: summaryFor(rep, outcome),
      runDir: ctx.runDir,
      decision,
      cleanup
    });
  } finally {
    lock?.release();
  }
}

function safeReport(ctx, target) {
  try {
    return report(ctx, target);
  } catch (err) {
    if (err instanceof MergeError && err.exitCode !== 2) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: merge-ready.mjs <command> [pr] [options]

Commands:
  check [pr]              Evaluate the merge conditions and resolve the method (JSON report)
  method [pr]             Resolve the merge method only
  merge [pr]              Under the merge lock: check again, merge, clean up, log the decision,
                          print a contract result block

[pr] is a number, #<n>, or a URL (default: the pull request of the current branch).

Options:
  --method <m>            repo, squash, rebase or merge (default: merge.method)
  --wait                  check: poll while checks are pending
  --wait-minutes <n>      check --wait timeout (default: merge.checks_timeout_minutes)
  --poll-seconds <n>      check --wait interval (default 30)
  --lock <path>           merge: lock file to hold (default: AF_MERGE_LOCK)
  --lock-timeout-minutes <n>  merge: wait for a busy lock (default: merge.checks_timeout_minutes)
  --dry-run               merge: evaluate only, never merge
  --halt <reason>         merge: record a Halt and report halted, never merge
  --run-dir <path>        Run directory: halt signals, decisions and merge events
  --config-snapshot <p>   Config snapshot
  --project-dir <dir>     Repository root (default: nearest git root)

Exit codes: check and method 0 when they ran; merge exits with the contract code of its
status (0 done or merged, 10 awaiting-human, 20 halted, 1 failed); 2 usage error.

Environment:
  AF_MERGE_LOCK           Harness merge lock path; standalone runs merge without a lock
  ESP_GH_CMD              JSON array replacing the gh command (tests)`;

const BOOLEAN_OPTIONS = new Set(["wait", "dry-run", "help"]);

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
        throw new MergeError(`--${key} requires a value`, 2);
      options[key] = value;
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

function positiveNumber(raw, name, min) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min)
    throw new MergeError(`--${name} must be a number >= ${min}`, 2);
  return value;
}

/** Shared context: config, run dir, client, clock. */
export function buildContext(options, env = process.env, io = {}) {
  const projectDir = resolve(
    options["project-dir"] ?? findRepoRoot(process.cwd()) ?? process.cwd()
  );
  let config;
  try {
    ({ config } = loadConfig({
      projectDir,
      snapshot: options["config-snapshot"],
      env
    }));
  } catch (err) {
    if (err instanceof ConfigError)
      throw new MergeError(err.message, err.exitCode ?? 1);
    throw err;
  }
  const runDir = options["run-dir"]
    ? resolve(expandHome(options["run-dir"]))
    : null;
  if (runDir && !existsSync(join(runDir, "run.json")))
    throw new MergeError(`Not a run directory (no run.json): ${runDir}`, 2);
  if (
    options.method &&
    options.method !== "repo" &&
    !METHODS.includes(options.method)
  ) {
    throw new MergeError(`--method must be repo, ${METHODS.join(", ")}`, 2);
  }
  return {
    config,
    projectDir,
    runDir,
    method: options.method ?? null,
    env,
    sleep: io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    now: io.now ?? (() => new Date()),
    log: io.log ?? ((line) => process.stderr.write(`[merge-ready] ${line}\n`)),
    inspectWorktree:
      io.inspectWorktree ??
      (() => worktreeCleanup(projectDir, config.worktrees ?? {})),
    get client() {
      return io.client ?? ghClient({ cwd: projectDir, env });
    }
  };
}

export async function run(argv, env = process.env, io = {}) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command)
    return { output: USAGE, exitCode: command ? 0 : 2 };
  const ctx = buildContext(options, env, io);
  const target = prArgument(args.join(" "));
  const merge = ctx.config.merge ?? {};
  switch (command) {
    case "check": {
      if (!options.wait) return { output: report(ctx, target) };
      const timeoutMinutes =
        options["wait-minutes"] !== undefined
          ? positiveNumber(options["wait-minutes"], "wait-minutes", 0)
          : (merge.checks_timeout_minutes ?? 30);
      const pollSeconds =
        options["poll-seconds"] !== undefined
          ? positiveNumber(options["poll-seconds"], "poll-seconds", 1)
          : 30;
      return {
        output: await waitForChecks(ctx, target, {
          timeoutMinutes,
          pollSeconds
        })
      };
    }
    case "method": {
      const facts = gather(ctx, target);
      return {
        output: {
          pr: facts.pr.number,
          policy: facts.policy,
          ...resolveMethod(facts.policy, {
            method: ctx.method ?? merge.method ?? "repo",
            preference: merge.preference ?? METHODS
          })
        }
      };
    }
    case "merge": {
      const block = await cmdMerge(ctx, target, {
        dryRun: Boolean(options["dry-run"]),
        halt: options.halt,
        lock: options.lock,
        lockTimeoutMinutes:
          options["lock-timeout-minutes"] !== undefined
            ? positiveNumber(
                options["lock-timeout-minutes"],
                "lock-timeout-minutes",
                0
              )
            : undefined
      });
      return {
        output: JSON.stringify(block),
        exitCode: exitCodeFor(block.status)
      };
    }
    default:
      throw new MergeError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

async function main() {
  try {
    const { output, exitCode = 0 } = await run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    process.stdout.write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known =
      err instanceof MergeError ||
      err.name === "WaitError" ||
      err.name === "RunsError";
    process.stderr.write(
      `merge-ready error: ${known ? err.message : (err.stack ?? err)}\n`
    );
    process.exitCode = known ? (err.exitCode ?? 1) : 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
