import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { keywords, readSummary, resolveRange } from "../recap.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECAP = join(HERE, "..", "recap.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const SHIP = join(HERE, "..", "ship.mjs");
const NOW = "2026-11-10T12:00:00.000Z";

let tmp;
let home;
let standalone;
let harness;

function cli(script, args, { now = NOW, project = tmp } = {}) {
  const r = spawnSync(
    process.execPath,
    [script, ...args, "--project-dir", project],
    {
      encoding: "utf8",
      env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: now }
    }
  );
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout)
  };
}

const recap = (...args) => cli(RECAP, args);

function runs(args, now) {
  const r = cli(RUNS, args, { now });
  assert.equal(r.code === 0 || r.code > 2, true, r.stderr);
  return r.stdout.trim()
    ? r.stdout.trim().startsWith("{")
      ? r.json()
      : r.stdout
    : null;
}

/** A run built with the contract tooling, like esp-go and esp-go-light leave it. */
function makeRun(
  root,
  {
    date,
    slug,
    title,
    workflow,
    repo,
    status,
    pr,
    decisions = [],
    steps = [],
    summary,
    critical = []
  }
) {
  const now = `${date}T09:00:00.000Z`;
  const { run_dir: dir } = runs(
    [
      "create",
      slug,
      "--root",
      root,
      "--date",
      date,
      "--title",
      title,
      "--workflow",
      workflow,
      "--repo",
      repo,
      "--type",
      "workflow"
    ],
    now
  );
  for (const d of decisions) {
    runs(
      [
        "decision",
        "--run-dir",
        dir,
        "--json",
        JSON.stringify({
          phase: "build",
          source: "agent",
          rationale: "because",
          ...d
        })
      ],
      now
    );
    runs(["update", "--run-dir", dir, "--max-risk", d.risk], now);
  }
  for (const [name, block] of steps)
    runs(
      ["result", name, "--run-dir", dir, "--json", JSON.stringify(block)],
      now
    );
  if (critical.length > 0) {
    writeFileSync(
      join(dir, "review-1.json"),
      JSON.stringify({ review_format: 1, findings: critical, rejected: [] })
    );
  }
  if (summary) writeFileSync(join(dir, "summary.md"), summary);
  const update = ["update", "--run-dir", dir, "--status", status];
  if (pr) update.push("--pr", pr);
  runs(update, `${date}T10:00:00.000Z`);
  return dir;
}

function summaryMd({
  task,
  title,
  workflow,
  status,
  outcome,
  critical = "None.",
  surprises = "None."
}) {
  return [
    "---",
    `task: ${task}`,
    `title: "${title}"`,
    `workflow: ${workflow}`,
    `status: ${status}`,
    "critical_findings: 0",
    "---",
    "",
    `# ${title}`,
    "",
    "## Outcome",
    "",
    outcome,
    "",
    "Second paragraph.",
    "",
    "## Decisions",
    "",
    "None.",
    "",
    "## Surprises",
    "",
    surprises,
    "",
    "## Critical Findings",
    "",
    critical,
    ""
  ].join("\n");
}

function seed() {
  makeRun(standalone, {
    date: "2026-11-01",
    slug: "old-task",
    title: "Old task",
    workflow: "esp-go-light",
    repo: "o/api",
    status: "merged"
  });
  const go = makeRun(standalone, {
    date: "2026-11-08",
    slug: "add-token-refresh",
    title: "Add token refresh",
    workflow: "esp-go",
    repo: "o/api",
    status: "merged",
    pr: "https://github.com/o/api/pull/42",
    decisions: [
      {
        decision: "Rotate refresh tokens on every use",
        risk: "high",
        alternatives: ["Keep tokens for their lifetime"],
        files: ["src/auth/refresh.ts"],
        commit: "abcdef1"
      },
      { decision: "Name the helper refreshToken", risk: "low" }
    ],
    steps: [
      ["plan", { status: "done", summary: "2 milestones" }],
      [
        "build",
        {
          status: "done",
          summary: "built",
          commit: "abcdef1",
          files_changed: ["src/auth/refresh.ts"]
        }
      ],
      [
        "go",
        {
          status: "merged",
          summary: "merged",
          pr: "https://github.com/o/api/pull/42"
        }
      ]
    ],
    critical: [
      {
        id: "F1",
        severity: "critical",
        dimension: "security",
        class: "A",
        location: "src/auth/refresh.ts:10",
        title: "Token logged in clear"
      }
    ],
    summary: summaryMd({
      task: "2026-11-08-add-token-refresh",
      title: "Add token refresh",
      workflow: "esp-go",
      status: "merged",
      outcome: "Token refresh is merged in PR #42.",
      surprises: "The HTTP client retried 401 responses on its own."
    })
  });
  // An esp-go-light run that escalated and was taken over by esp-go.
  makeRun(harness, {
    date: "2026-11-09",
    slug: "fix-typo",
    title: "Fix login typo",
    workflow: "esp-go-light",
    repo: "o/web",
    status: "halted",
    decisions: [
      {
        decision: "Escalate to esp-go: 14 files",
        risk: "medium",
        phase: "implement"
      }
    ],
    steps: [
      ["go-light", { status: "escalate", summary: "too many files" }],
      ["go", { status: "halted", summary: "halted on budget" }]
    ],
    summary: summaryMd({
      task: "2026-11-09-fix-typo",
      title: "Fix login typo",
      workflow: "esp-go",
      status: "halted",
      outcome: "Halted on the wall-time budget.",
      critical: "- A migration drops a column without a backup."
    })
  });
  return go;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-recap-"));
  home = join(tmp, "home");
  standalone = join(tmp, "runs");
  harness = join(tmp, "af-runs");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      runs: { root: standalone },
      recap: {
        roots: [standalone, harness],
        default_range_days: 7,
        fan_out_threshold: 5
      }
    })
  );
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("range", () => {
  test("defaults to recap.default_range_days, today included", () => {
    const at = new Date(NOW);
    assert.deepEqual(
      resolveRange({}, { recap: { default_range_days: 7 } }, at),
      { since: "2026-11-04", until: null, default: true }
    );
    assert.deepEqual(resolveRange({ all: true }, {}, at), {
      since: null,
      until: null
    });
    assert.equal(resolveRange({ last: "2d" }, {}, at).since, "2026-11-08");
    assert.deepEqual(resolveRange({ until: "2026-11-02" }, {}, at), {
      since: null,
      until: "2026-11-02"
    });
  });

  test("keywords drop stopwords and short words", () => {
    assert.deepEqual(
      keywords("Why did we rotate the refresh tokens in src/auth?"),
      ["rotate", "refresh", "token", "src/auth"]
    );
  });
});

describe("collect", () => {
  test("reads every root in recap.roots and applies the default range", () => {
    seed();
    const out = recap("collect");
    assert.equal(out.code, 0, out.stderr);
    const data = out.json();
    assert.equal(data.roots.length, 2);
    assert.deepEqual(
      data.runs.map((r) => r.id),
      ["2026-11-08-add-token-refresh", "2026-11-09-fix-typo"]
    );
    const [go, light] = data.runs;
    assert.equal(go.outcome, "Token refresh is merged in PR #42.");
    assert.equal(go.pr, "https://github.com/o/api/pull/42");
    assert.deepEqual(go.decisions, {
      count: 2,
      by_risk: { low: 1, medium: 0, high: 1 }
    });
    assert.equal(go.critical_findings, 1);
    assert.equal(go.commits, 1);
    assert.equal(
      light.workflow,
      "esp-go",
      "the summary names the workflow that ended the run"
    );
    assert.equal(light.run_workflow, "esp-go-light");
    assert.deepEqual(
      light.steps.map((s) => s.status),
      ["escalate", "halted"]
    );
    assert.equal(data.fan_out, false);
  });

  test("filters by --since, --until, --last, --repo, --status and --risk", () => {
    seed();
    const ids = (...args) =>
      recap("collect", ...args)
        .json()
        .runs.map((r) => r.id);
    assert.equal(ids("--all").length, 3);
    assert.deepEqual(ids("--since", "2026-11-01", "--until", "2026-11-02"), [
      "2026-11-01-old-task"
    ]);
    assert.deepEqual(ids("--last", "2d"), [
      "2026-11-08-add-token-refresh",
      "2026-11-09-fix-typo"
    ]);
    assert.deepEqual(ids("--all", "--repo", "web"), ["2026-11-09-fix-typo"]);
    assert.deepEqual(ids("--all", "--status", "merged"), [
      "2026-11-01-old-task",
      "2026-11-08-add-token-refresh"
    ]);
    assert.deepEqual(ids("--all", "--risk", "high"), [
      "2026-11-08-add-token-refresh"
    ]);
    assert.equal(recap("collect", "--risk", "extreme").code, 2);
    assert.equal(recap("collect", "--last", "soon").code, 2);
  });

  test("fans out in batches above recap.fan_out_threshold", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        runs: { root: standalone },
        recap: { roots: [standalone], fan_out_threshold: 2 }
      })
    );
    for (const n of [1, 2, 3]) {
      makeRun(standalone, {
        date: "2026-11-09",
        slug: `task-${n}`,
        title: `Task ${n}`,
        workflow: "esp-go",
        repo: "o/api",
        status: "done"
      });
    }
    const data = recap("collect").json();
    assert.equal(data.count, 3);
    assert.equal(data.fan_out, true);
    assert.deepEqual(
      data.batches.map((b) => b.length),
      [2, 1]
    );
  });
});

describe("show", () => {
  test("returns one run in full by id, with sources", () => {
    seed();
    const out = recap("show", "2026-11-08-add-token-refresh");
    assert.equal(out.code, 0, out.stderr);
    const data = out.json();
    assert.equal(data.run.workflow, "esp-go");
    assert.equal(
      data.summary.sections.Surprises,
      "The HTTP client retried 401 responses on its own."
    );
    assert.match(data.decisions[0].source, /decisions\.jsonl:1$/);
    assert.deepEqual(
      data.steps.map((s) => s.step),
      ["01-plan", "02-build", "03-go"]
    );
    assert.equal(data.commits[0].sha, "abcdef1");
    assert.equal(data.critical_findings[0].id, "F1");
    assert.equal(recap("show", "missing-run").code, 1);
    assert.equal(recap("show").code, 2);
  });
});

describe("risks", () => {
  test("lists high-risk decisions, critical findings and stopped runs with sources", () => {
    seed();
    const data = recap("risks", "--all").json();
    assert.equal(data.decisions.length, 1);
    assert.equal(
      data.decisions[0].decision,
      "Rotate refresh tokens on every use"
    );
    assert.match(
      data.decisions[0].source,
      /add-token-refresh[\\/]decisions\.jsonl:1$/
    );
    assert.equal(data.critical_findings.length, 2);
    assert.match(data.critical_findings[0].source, /review-1\.md$/);
    assert.equal(
      data.critical_findings[1].title,
      "- A migration drops a column without a backup."
    );
    assert.match(data.critical_findings[1].source, /summary\.md$/);
    assert.deepEqual(
      data.stopped_runs.map((r) => r.status),
      ["halted"]
    );
    assert.equal(
      recap("risks", "--all", "--min-risk", "medium").json().decisions.length,
      2
    );
    assert.equal(recap("risks", "--min-risk", "severe").code, 2);
  });
});

describe("sources", () => {
  test("returns candidates in the order decisions, summaries, git, PRs", () => {
    seed();
    const data = recap(
      "sources",
      "--all",
      "--question",
      "Why are refresh tokens rotated?"
    ).json();
    assert.deepEqual(data.order, ["decisions", "summaries", "git", "prs"]);
    assert.equal(
      data.decisions[0].decision,
      "Rotate refresh tokens on every use"
    );
    assert.ok(data.summaries.some((s) => s.section === "Outcome"));
    assert.equal(data.git.length, 1);
    assert.deepEqual(data.git[0].files, ["src/auth/refresh.ts"]);
    assert.equal(data.git[0].commits[0].sha, "abcdef1");
    assert.deepEqual(
      data.prs.map((p) => p.pr),
      ["https://github.com/o/api/pull/42"]
    );
    assert.equal(recap("sources", "--all").code, 2);
    assert.equal(recap("sources", "--all", "--question", "is it?").code, 2);
  });
});

describe("runs written by esp-ship", () => {
  test("recaps an escalated inline run taken over on the orchestrated track", () => {
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const git = (...args) => {
      const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git("add", "a.txt");
    git(
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=T",
      "commit",
      "-qm",
      "init"
    );
    git("switch", "-qc", "feature/oauth");
    const { run_dir: dir } = runs([
      "create",
      "oauth",
      "--root",
      standalone,
      "--title",
      "Add OAuth login",
      "--workflow",
      "esp-ship",
      "--repo",
      "o/api"
    ]);
    const ship = (...args) =>
      cli(SHIP, [...args, "--run-dir", dir], { project: repo });
    const started = ship(
      "init",
      "--request",
      "Add OAuth login",
      "--base",
      "main",
      "--track",
      "inline",
      "--caller-owned"
    );
    assert.equal(started.code, 0, started.stderr);
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
    runs([
      "result",
      "ship",
      "--run-dir",
      dir,
      "--json",
      escalated.stdout.trim()
    ]);
    runs(["update", "--run-dir", dir, "--status", "halted"]);
    const resumed = ship("init", "--resume");
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(resumed.json().track, "orchestrated");
    const stop = ship("stop", "--status", "halted", "--reason", "budget");
    assert.equal(stop.code === 0 || stop.code > 2, true, stop.stderr);

    const data = recap("collect").json();
    assert.equal(data.runs.length, 1);
    const [r] = data.runs;
    assert.equal(r.run_workflow, "esp-ship");
    assert.equal(r.steps[0].step, "01-ship");
    assert.equal(r.steps[0].status, "escalate");
    assert.ok(r.decisions.count >= 1);
    const shown = recap("show", dir).json();
    assert.ok(
      shown.decisions.some((d) =>
        /12 files estimated/.test(`${d.decision} ${d.rationale}`)
      )
    );
    const asked = recap(
      "sources",
      "--question",
      "Why was the OAuth login escalated?"
    ).json();
    assert.ok(asked.decisions.length >= 1);
    assert.equal(asked.git[0].branch, shown.run.branch);
  });
});

describe("readSummary", () => {
  test("returns null without summary.md and ignores headings in fences", () => {
    const dir = join(tmp, "r");
    mkdirSync(dir);
    assert.equal(readSummary(dir), null);
    writeFileSync(
      join(dir, "summary.md"),
      '---\ntask: r\ntitle: "R"\nstatus: done\n---\n\n## Outcome\n\n```md\n## Not a section\n```\n'
    );
    const s = readSummary(dir);
    assert.deepEqual(Object.keys(s.sections), ["Outcome"]);
    assert.equal(s.frontmatter.title, "R");
  });
});
