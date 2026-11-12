import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../lib/contract.mjs";
import { decide, detectRequest } from "../lib/ship/triage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "ship.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const PLAN = join(HERE, "..", "plan.mjs");
const REFERENCE = join(HERE, "..", "..", "references", "plan-format.md");
const NOW = "2026-11-08T12:00:00.000Z";

// A backlog: checkbox progress list, packages as #### headings with fields.
const FRC_BACKLOG = `# Fleet rollout backlog

Rollout of the fleet controller.

## Progress

- [x] FRC-01: Inventory model
- [ ] FRC-02: Health probe
- [ ] FRC-03: Rollout command

## Packages

#### FRC-01: Inventory model

- **Goal**: Store the fleet inventory
- **Complexity**: low
- **Files**: \`src/inventory.ts\`, \`test/inventory.test.ts\`

#### FRC-02: Health probe

- **Goal**: Probe each host and report its health
- **Complexity**: medium
- **Depends**: FRC-01
- **Files**: \`src/probe.ts\` (new), \`test/probe.test.ts\` (new)

**Tasks**:

1. Add \`probe(host)\`
2. Add a timeout

**Acceptance Criteria**:

- A dead host reports \`down\` within the timeout

**Validation**:

- \`npm test -- probe\`

#### FRC-03: Rollout command

- **Goal**: Roll a version out host by host
- **Depends**: FRC-02
- **Files**: \`src/rollout.ts\`

**Tasks**:

- Add the \`rollout\` command

**Acceptance Criteria**:

- A failing probe stops the rollout

**Validation**:

- \`npm test -- rollout\`
`;

// A progress file: checkbox list, milestones as ### headings with subsections.
const ORC_PROGRESS = `---
title: Orchestrator progress
---

# Orchestrator

- [ ] ORC-001 Scheduler loop
- [ ] ORC-002 Retry policy
- [ ] Write the release notes

### ORC-002 - Retry policy

- **Goal**: Retry failed jobs with backoff
- **Complexity**: low
- **Depends**: ORC-001
- **Files**: \`src/retry.ts\`

#### Tasks

1. Add exponential backoff

#### Acceptance Criteria

- A job is retried three times at most

#### Validation

- \`pnpm test retry\`

### ORC-001 - Scheduler loop

- **Goal**: Run queued jobs in order
- **Complexity**: high
- **Depends**: none
- **Files**: \`src/scheduler.ts\`, \`test/scheduler.test.ts\`

#### Tasks

1. Add the loop

#### Acceptance Criteria

- Jobs run in FIFO order

#### Validation

- \`pnpm test scheduler\`

#### Notes

- Free text that is not part of the milestone
`;

const allChecked = (text) => text.replace(/- \[ \]/g, "- [x]");

function referenceExample() {
  const text = readFileSync(REFERENCE, "utf8");
  const example = text.slice(text.indexOf("## Example"));
  return `${/```markdown\r?\n([\s\S]*?)\r?\n```\s*$/.exec(example)[1]}\n`;
}

let tmp;
let home;
let repo;
let runDir;

function cli(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW }
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout)
  };
}

const triage = (...args) =>
  cli(SCRIPT, ["triage", ...args, "--project-dir", repo]);

function git(...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const decisions = () =>
  existsSync(join(runDir, "decisions.jsonl"))
    ? readFileSync(join(runDir, "decisions.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function file(name, text) {
  writeFileSync(join(repo, name), text);
  return join(repo, name);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-triage-"));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "init");
  const created = cli(RUNS, [
    "create",
    "triage",
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

describe("detectRequest", () => {
  test("a FRC-style backlog is a task list with each package's state", () => {
    const d = detectRequest(file("backlog.md", FRC_BACKLOG), {
      projectDir: repo
    });
    assert.equal(d.input_kind, "task-list");
    assert.deepEqual(
      d.packages.map((p) => [p.id, p.checked]),
      [
        ["FRC-01", true],
        ["FRC-02", false],
        ["FRC-03", false]
      ]
    );
  });

  test("an ORC-style progress file is a task list; items without a heading are ignored", () => {
    const d = detectRequest(file("progress.md", ORC_PROGRESS), {
      projectDir: repo
    });
    assert.equal(d.input_kind, "task-list");
    assert.deepEqual(
      d.packages.map((p) => [p.id, p.title, p.checked]),
      [
        ["ORC-001", "Scheduler loop", false],
        ["ORC-002", "Retry policy", false]
      ]
    );
    assert.deepEqual(d.unmatched, []);
  });

  test("a relative path resolves from the project directory", () => {
    file("backlog.md", FRC_BACKLOG);
    assert.equal(
      detectRequest("backlog.md", { projectDir: repo }).input_kind,
      "task-list"
    );
  });

  test("a valid plan is a plan, a broken plan or other file is a document", () => {
    const example = referenceExample();
    assert.equal(
      detectRequest(file("plan.md", example), { projectDir: repo }).input_kind,
      "plan"
    );
    const broken = detectRequest(
      file("broken.md", example.replace("## Risks", "## Hazards")),
      { projectDir: repo }
    );
    assert.equal(broken.input_kind, "document");
    assert.ok(broken.plan_errors.length > 0);
    const doc = detectRequest(
      file("design.md", "# Design\n\n1. Add a cache\n2. Use it\n"),
      { projectDir: repo }
    );
    assert.equal(doc.input_kind, "document");
    assert.equal(doc.plan_errors, null);
  });

  test("issue references and prompts", () => {
    for (const [text, number, repoName] of [
      ["#12", 12, null],
      ["o/r#3", 3, "o/r"],
      ["https://github.com/o/r/issues/45", 45, "o/r"]
    ]) {
      const d = detectRequest(text, { projectDir: repo });
      assert.equal(d.input_kind, "issue", text);
      assert.equal(d.issue.number, number);
      assert.equal(d.issue.repo, repoName);
    }
    assert.equal(
      detectRequest("Add a --json flag to status", { projectDir: repo })
        .input_kind,
      "prompt"
    );
    assert.equal(
      detectRequest("missing-file.md", { projectDir: repo }).input_kind,
      "prompt"
    );
  });
});

describe("decide", () => {
  const plan = { input_kind: "plan", path: "/r/plan.md" };
  const list = (checked) => ({
    input_kind: "task-list",
    path: "/r/backlog.md",
    packages: [
      { id: "FRC-01", checked: true },
      { id: "FRC-02", checked }
    ]
  });
  const prompt = { input_kind: "prompt", path: null };

  test("a plan file is reused on the orchestrated track", () => {
    const r = decide(plan);
    assert.equal(r.plan_source, "reuse");
    assert.equal(r.plan_path, "/r/plan.md");
    assert.equal(r.track, "orchestrated");
    assert.deepEqual(
      r.choices.map((c) => [c.key, c.source]),
      [
        ["plan", "policy"],
        ["track", "policy"]
      ]
    );
    assert.equal(decide(plan, { track: "orchestrated" }).track_source, "operator");
    assert.throws(() => decide(plan, { track: "inline" }), /orchestrated/);
  });

  test("a plan already in the run directory is reused for any request", () => {
    const r = decide(prompt, { runPlan: "/run/plan.md" });
    assert.equal(r.plan_source, "reuse");
    assert.equal(r.plan_path, "/run/plan.md");
    assert.equal(r.needs_judgment, false);
  });

  test("a fully checked task list has nothing to do", () => {
    const r = decide(list(true));
    assert.equal(r.nothing_to_do, true);
    assert.equal(r.track, null);
    assert.deepEqual(r.choices.map((c) => c.key), ["nothing_to_do"]);
  });

  test("an open task list or a document is imported on the orchestrated track", () => {
    const r = decide(list(false));
    assert.equal(r.plan_source, "import");
    assert.equal(r.track, "orchestrated");
    assert.match(r.choices[0].rationale, /FRC-02/);
    assert.equal(
      decide({ input_kind: "document", path: "/r/d.md" }).plan_source,
      "import"
    );
    const inline = decide(list(false), { track: "inline" });
    assert.equal(inline.track, "inline");
    assert.equal(inline.plan_source, "none");
  });

  test("a prompt needs the model's judgment unless --track is given", () => {
    assert.equal(decide(prompt).needs_judgment, true);
    const pinned = decide(prompt, { track: "orchestrated" });
    assert.equal(pinned.plan_source, "generate");
    assert.equal(pinned.track_source, "operator");
  });

  test("the judged track is an agent choice bounded by max_files_changed", () => {
    const r = decide(prompt, {
      judged: "inline",
      estimate: 3,
      reason: "one concern",
      maxFiles: 10
    });
    assert.equal(r.track, "inline");
    assert.equal(r.track_source, "agent");
    assert.equal(r.plan_source, "none");
    assert.match(r.choices[0].rationale, /3 file\(s\) estimated \(limit 10\)/);
    assert.throws(
      () =>
        decide(prompt, {
          judged: "inline",
          estimate: 11,
          reason: "x",
          maxFiles: 10
        }),
      /judge orchestrated/
    );
    assert.throws(() => decide(prompt, { judged: "inline" }), /--estimate/);
    assert.equal(
      decide({ input_kind: "issue" }, {
        judged: "orchestrated",
        estimate: 14,
        reason: "two modules"
      }).plan_source,
      "generate"
    );
  });
});

describe("ship.mjs triage", () => {
  test("--record logs one decision per choice and writes the triage step", () => {
    const path = file("backlog.md", FRC_BACKLOG);
    const r = triage("--request", path, "--run-dir", runDir, "--record");
    assert.equal(r.code, 0, r.stderr);
    const out = r.json();
    assert.equal(out.recorded, true);
    assert.equal(out.step, "01-triage");
    const block = JSON.parse(
      readFileSync(join(runDir, "steps", "01-triage", "result.json"), "utf8")
    );
    assert.deepEqual(validateArtifact("result", block).errors, []);
    assert.equal(block.outputs.input_kind, "task-list");
    assert.equal(block.outputs.plan_source, "import");
    assert.equal(block.outputs.track, "orchestrated");
    const logged = decisions();
    assert.deepEqual(
      logged.map((d) => [d.phase, d.source, d.decision]),
      [
        ["triage", "policy", "Import the request into a plan"],
        ["triage", "policy", "Orchestrated track"]
      ]
    );
    for (const d of logged)
      assert.deepEqual(validateArtifact("decision", d).errors, []);
    assert.deepEqual(block.outputs.decisions, ["D001", "D002"]);

    const again = triage("--request", path, "--run-dir", runDir, "--record");
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.json().recorded, false);
    assert.equal(decisions().length, 2);
  });

  test("a fully checked task list ends done with no branch and no ship.json", () => {
    const branches = git("branch", "--list");
    const path = file("backlog.md", allChecked(FRC_BACKLOG));
    const r = triage("--request", path, "--run-dir", runDir, "--record");
    assert.equal(r.code, 0, r.stderr);
    const { result } = r.json();
    assert.equal(result.status, "done");
    assert.equal(result.outputs.nothing_to_do, true);
    assert.match(result.summary, /Nothing to do/);
    assert.equal(decisions()[0].decision, "Nothing to do");
    assert.equal(existsSync(join(runDir, "ship.json")), false);
    assert.equal(git("branch", "--list"), branches);
    assert.deepEqual(readdirSync(join(runDir, "steps")), ["01-triage"]);
  });

  test("a prompt is recorded with the judged track as an agent decision", () => {
    const missing = triage(
      "--request",
      "Fix the typo in a.txt",
      "--run-dir",
      runDir,
      "--record"
    );
    assert.equal(missing.code, 2);
    assert.equal(decisions().length, 0);
    const r = triage(
      "--request",
      "Fix the typo in a.txt",
      "--run-dir",
      runDir,
      "--record",
      "--judged-track",
      "inline",
      "--estimate",
      "1",
      "--reason",
      "one file, one concern"
    );
    assert.equal(r.code, 0, r.stderr);
    const [track, planChoice] = decisions();
    assert.equal(track.source, "agent");
    assert.equal(track.decision, "Inline track");
    assert.equal(track["x-esp-estimate"], 1);
    assert.match(track.rationale, /one file, one concern/);
    assert.equal(planChoice.decision, "No plan");
  });

  test("the inline limit comes from the config", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ version: 1, ship: { inline: { max_files_changed: 2 } } })
    );
    const r = triage(
      "--request",
      "Fix it",
      "--judged-track",
      "inline",
      "--estimate",
      "3",
      "--reason",
      "x"
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /allows 2 changed files/);
  });

  test("an imported task list lints with one milestone per open package", () => {
    const path = file("progress.md", ORC_PROGRESS);
    const r = cli(PLAN, ["import", path, "--run-dir", runDir]);
    assert.equal(r.code, 0, r.stderr);
    const report = r.json();
    assert.equal(report.valid, true, JSON.stringify(report.errors));
    assert.deepEqual(report.milestones, ["M1", "M2"]);
    assert.deepEqual(report.mapping, { "ORC-001": "M1", "ORC-002": "M2" });
    const next = triage("--request", "anything", "--run-dir", runDir);
    assert.equal(next.json().plan_source, "reuse");
  });
});
