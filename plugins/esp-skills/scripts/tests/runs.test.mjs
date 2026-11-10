import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_DIR } from "../lib/contract.mjs";
import {
  indexRuns,
  latestPlan,
  slugify,
  stepDirName,
  validateFile
} from "../runs.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "runs.mjs");
const FIXTURES = join(CONTRACT_DIR, "fixtures");
const NOW = "2026-11-10T12:00:00.000Z";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const fixture = (artifact, name) =>
  readJson(join(FIXTURES, artifact, "valid", `${name}.json`));

let root;
let home;
let project;

function cli(args, { input, now = NOW } = {}) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, ...args, "--project-dir", project],
    {
      env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: now },
      encoding: "utf8",
      input: input ?? ""
    }
  );
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout)
  };
}

function createRun(extra = []) {
  const out = cli([
    "create",
    "Fix login timeout",
    "--root",
    join(root, "runs"),
    "--title",
    "Fix login timeout",
    "--workflow",
    "esp-go-light",
    "--repo",
    "e-stpierre/skills",
    "--base",
    "main",
    ...extra
  ]);
  assert.equal(out.code, 0, out.stderr);
  return out.json().run_dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "esp-runs-"));
  home = join(root, "home");
  project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("create", () => {
  test("creates <root>/<date>-<slug> with a golden run.json and run.started event", () => {
    const dir = createRun();
    assert.equal(dir, join(root, "runs", "2026-11-10-fix-login-timeout"));
    assert.deepEqual(
      readJson(join(dir, "run.json")),
      fixture("run", "created-by-runs-mjs")
    );
    assert.deepEqual(readJsonl(join(dir, "events.jsonl")), [
      fixture("event", "run-started-by-runs-mjs")
    ]);
  });

  test("uses runs.root from the config when no root is given", () => {
    const runsRoot = join(root, "configured-runs");
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ runs: { root: runsRoot } })
    );
    const out = cli(["create", "task"]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.json().run_dir, join(runsRoot, "2026-11-10-task"));
  });

  test("uses runs.root from a config snapshot", () => {
    const snapshot = join(root, "snapshot.json");
    writeFileSync(
      snapshot,
      JSON.stringify({ runs: { root: join(root, "snap-runs") } })
    );
    const out = cli(["create", "task", "--config-snapshot", snapshot]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(
      out.json().run_dir,
      join(root, "snap-runs", "2026-11-10-task")
    );
  });

  test("adds a numeric suffix when the directory exists", () => {
    createRun();
    const second = createRun();
    assert.equal(second, join(root, "runs", "2026-11-10-fix-login-timeout-2"));
  });

  test("--run-dir creates the given directory, and reuses an existing run", () => {
    const dir = join(root, "harness", "T01-add-oauth");
    const first = cli(["create", "--run-dir", dir, "--type", "workflow"]);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.json(), {
      run_dir: dir,
      id: "T01-add-oauth",
      created: true
    });
    const second = cli(["create", "--run-dir", dir]);
    assert.equal(second.json().created, false);
    assert.equal(readJsonl(join(dir, "events.jsonl")).length, 1);
  });

  test("rejects an invalid type before writing anything", () => {
    const out = cli([
      "create",
      "x",
      "--root",
      join(root, "runs"),
      "--type",
      "job"
    ]);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /type: expected one of/);
    assert.equal(existsSync(join(root, "runs", "2026-11-10-x")), false);
  });

  test("slugify keeps directory names safe", () => {
    assert.equal(
      slugify("Ajouter l'écran Été / v2!"),
      "ajouter-l-ecran-ete-v2"
    );
    assert.throws(() => slugify("!!!"), /slug/);
  });
});

describe("update", () => {
  test("sets fields, raises max_risk only, and emits status events", () => {
    const dir = createRun();
    let out = cli([
      "update",
      "--run-dir",
      dir,
      "--status",
      "paused",
      "--max-risk",
      "high"
    ]);
    assert.equal(out.code, 0, out.stderr);
    out = cli(
      ["update", "--run-dir", dir, "--max-risk", "low", "--status", "running"],
      {
        now: "2026-11-10T12:10:00.000Z"
      }
    );
    out = cli(
      [
        "update",
        "--run-dir",
        dir,
        "--status",
        "merged",
        "--pr",
        "https://github.com/e-stpierre/skills/pull/12",
        "--model",
        "builder=opus:high",
        "--budget",
        "wall_minutes=38"
      ],
      { now: "2026-11-10T12:38:00.000Z" }
    );
    assert.equal(out.code, 0, out.stderr);
    const run = out.json();
    assert.equal(run.status, "merged");
    assert.equal(run.max_risk, "high");
    assert.equal(run.ended_at, "2026-11-10T12:38:00.000Z");
    assert.deepEqual(run.models, {
      builder: { model: "opus", effort: "high" }
    });
    assert.deepEqual(run.budgets_used, { wall_minutes: 38 });
    assert.deepEqual(
      readJsonl(join(dir, "events.jsonl")).map((e) => [e.seq, e.type]),
      [
        [1, "run.started"],
        [2, "run.paused"],
        [3, "run.resumed"],
        [4, "run.completed"]
      ]
    );
  });

  test("rejects an invalid status and leaves run.json untouched", () => {
    const dir = createRun();
    const before = readFileSync(join(dir, "run.json"), "utf8");
    const out = cli(["update", "--run-dir", dir, "--status", "finished"]);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /status: expected one of/);
    assert.equal(readFileSync(join(dir, "run.json"), "utf8"), before);
  });

  test("requires a run directory", () => {
    assert.equal(cli(["update", "--status", "done"]).code, 2);
    assert.equal(cli(["get", "--run-dir", join(root, "nope")]).code, 1);
  });
});

describe("decisions", () => {
  const input = () => {
    const { id, at, ...rest } = fixture("decision", "appended-by-runs-mjs");
    return rest;
  };

  test("fills id and at, matches the golden fixture, and raises max_risk", () => {
    const dir = createRun();
    const out = cli([
      "decision",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify(input())
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(out.json(), fixture("decision", "appended-by-runs-mjs"));
    assert.equal(readJson(join(dir, "run.json")).max_risk, "medium");
  });

  test("reads the entry from stdin", () => {
    const dir = createRun();
    const out = cli(["decision", "--run-dir", dir], {
      input: JSON.stringify(input())
    });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.json().id, "D001");
  });

  test("is append-only: earlier lines are never rewritten", () => {
    const dir = createRun();
    const path = join(dir, "decisions.jsonl");
    cli(["decision", "--run-dir", dir, "--json", JSON.stringify(input())]);
    const first = readFileSync(path, "utf8");
    cli([
      "decision",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify({ ...input(), risk: "low" })
    ]);
    const second = readFileSync(path, "utf8");
    assert.ok(second.startsWith(first));
    assert.deepEqual(
      readJsonl(path).map((d) => d.id),
      ["D001", "D002"]
    );
  });

  test("an invalid entry is rejected and nothing is appended", () => {
    const dir = createRun();
    const out = cli([
      "decision",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify({ ...input(), source: "model" })
    ]);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /source: expected one of/);
    assert.equal(existsSync(join(dir, "decisions.jsonl")), false);
  });

  test("concurrent appends keep every line whole with unique ids", async () => {
    const dir = createRun();
    const workers = 12;
    const perWorker = 5;
    const runWorker = (w) =>
      new Promise((resolvePromise, reject) => {
        const code = `
          const { appendDecision } = await import(${JSON.stringify(
            new URL("../runs.mjs", import.meta.url).href
          )});
          for (let i = 0; i < ${perWorker}; i++) {
            appendDecision(${JSON.stringify(dir)}, {
              phase: "build", source: "agent", risk: "low",
              decision: "worker ${w} decision " + i + " " + "x".repeat(2000),
              rationale: "concurrency test"
            });
          }`;
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", code],
          {
            env: { ...process.env, ESP_RUNS_NOW: NOW },
            stdio: ["ignore", "ignore", "pipe"]
          }
        );
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr += d;
        });
        child.on("exit", (status) =>
          status === 0 ? resolvePromise() : reject(new Error(stderr))
        );
      });
    await Promise.all(Array.from({ length: workers }, (_, w) => runWorker(w)));
    const entries = readJsonl(join(dir, "decisions.jsonl"));
    assert.equal(entries.length, workers * perWorker);
    const ids = new Set(entries.map((e) => e.id));
    assert.equal(ids.size, workers * perWorker);
    assert.equal(validateFile(join(dir, "decisions.jsonl")).valid, true);
    assert.equal(existsSync(join(dir, "decisions.jsonl.lock")), false);
  });
});

describe("events", () => {
  test("appends with increasing seq and rejects unknown types", () => {
    const dir = createRun();
    const out = cli([
      "event",
      "pr.opened",
      "--run-dir",
      dir,
      "--data",
      '{"pr":"u"}'
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.json().seq, 2);
    const bad = cli(["event", "run.exploded", "--run-dir", dir]);
    assert.equal(bad.code, 1);
    assert.equal(readJsonl(join(dir, "events.jsonl")).length, 2);
    assert.equal(validateFile(join(dir, "events.jsonl")).valid, true);
  });
});

describe("result", () => {
  test("writes steps/NN-<step>/result.json and prints the block on one line", () => {
    const dir = createRun();
    const block = fixture("result", "done-full");
    const out = cli([
      "result",
      "build-M2",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify(block)
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout.trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse(out.stdout), block);
    assert.deepEqual(
      readJson(join(dir, "steps", "01-build-M2", "result.json")),
      block
    );
    const events = readJsonl(join(dir, "events.jsonl"));
    assert.deepEqual(events.at(-1).data, {
      step: "01-build-M2",
      status: "done"
    });
    assert.equal(events.at(-1).type, "step.completed");
  });

  test("adds contract_version and emits needs_input", () => {
    const dir = createRun();
    const { contract_version, ...block } = fixture("result", "awaiting-human");
    const out = cli([
      "result",
      "review",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify(block)
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).contract_version, 1);
    const types = readJsonl(join(dir, "events.jsonl")).map((e) => e.type);
    assert.deepEqual(types.slice(-2), ["step.completed", "needs_input"]);
  });

  test("rejects an invalid block without writing it", () => {
    const dir = createRun();
    const out = cli([
      "result",
      "plan",
      "--run-dir",
      dir,
      "--json",
      '{"status":"ok"}'
    ]);
    assert.equal(out.code, 1);
    assert.equal(existsSync(join(dir, "steps")), false);
  });

  test("step names are numbered once and reused on retry", () => {
    const dir = createRun();
    assert.equal(stepDirName(dir, "plan"), "01-plan");
    mkdirSync(join(dir, "steps", "01-plan"), { recursive: true });
    assert.equal(stepDirName(dir, "plan"), "01-plan");
    assert.equal(stepDirName(dir, "build-M1"), "02-build-M1");
    assert.equal(stepDirName(dir, "07-custom"), "07-custom");
    assert.throws(() => stepDirName(dir, "../x"), /Invalid step/);
  });

  test("exit-code maps statuses", () => {
    const codes = [
      "done",
      "merged",
      "awaiting-human",
      "halted",
      "escalate",
      "failed"
    ].map((s) => cli(["exit-code", s]).stdout.trim());
    assert.deepEqual(codes, ["0", "0", "10", "20", "30", "1"]);
  });
});

describe("plans, messages and amendments", () => {
  test("plan returns the latest version", () => {
    const dir = createRun();
    assert.deepEqual(latestPlan(dir), { path: null, version: 0, versions: [] });
    writeFileSync(join(dir, "plan.md"), "# v1");
    writeFileSync(join(dir, "plan.v3.md"), "# v3");
    writeFileSync(join(dir, "plan.v2.md"), "# v2");
    const out = cli(["plan", "--run-dir", dir]).json();
    assert.equal(out.version, 3);
    assert.equal(out.path, join(dir, "plan.v3.md"));
  });

  test("send, list and deliver operator messages", () => {
    const dir = createRun();
    const sent = cli([
      "send",
      "--run-dir",
      dir,
      "--text",
      "Use the existing retry helper instead of a new one."
    ]);
    assert.equal(sent.code, 0, sent.stderr);
    assert.deepEqual(sent.json(), fixture("inbox-message", "sent-by-runs-mjs"));
    assert.deepEqual(readdirSync(join(dir, "inbox")), [
      "20261110T120000000Z-m001.json"
    ]);
    cli(["send", "--run-dir", dir, "--text", "Second", "--mode", "now"]);
    assert.equal(cli(["messages", "--run-dir", dir]).json().length, 2);

    const delivered = cli(["deliver", "m001", "--run-dir", dir]);
    assert.equal(delivered.code, 0, delivered.stderr);
    assert.deepEqual(
      cli(["messages", "--run-dir", dir])
        .json()
        .map((m) => m.id),
      ["m002"]
    );
    assert.equal(cli(["messages", "--run-dir", dir, "--all"]).json().length, 2);
    const [decision] = readJsonl(join(dir, "decisions.jsonl"));
    const { id, ...expected } = fixture("decision", "operator");
    delete expected["x-esp-class"];
    assert.deepEqual(decision, { id: "D001", ...expected });
    const types = readJsonl(join(dir, "events.jsonl")).map((e) => e.type);
    assert.deepEqual(types, [
      "run.started",
      "message.queued",
      "message.queued",
      "message.delivered"
    ]);
    // Delivering twice is a no-op.
    assert.deepEqual(cli(["deliver", "m001", "--run-dir", dir]).json(), []);
  });

  test("send --target step requires --step", () => {
    const dir = createRun();
    const missing = cli([
      "send",
      "--run-dir",
      dir,
      "--text",
      "x",
      "--target",
      "step"
    ]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--step/);
    const ok = cli([
      "send",
      "--run-dir",
      dir,
      "--text",
      "x",
      "--target",
      "step",
      "--step",
      "build"
    ]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.json().step, "build");
  });

  test("amend appends to amendments.jsonl and logs an operator decision", () => {
    const dir = createRun();
    const missing = cli([
      "amend",
      "--run-dir",
      dir,
      "--text",
      "x",
      "--affects",
      "M2"
    ]);
    assert.equal(missing.code, 2);
    writeFileSync(join(dir, "plan.md"), "# v1");
    writeFileSync(join(dir, "plan.v2.md"), "# v2");
    const out = cli([
      "amend",
      "--run-dir",
      dir,
      "--text",
      "Support GitHub Enterprise hosts too.",
      "--affects",
      "M2,M3",
      "--from",
      "user"
    ]);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(out.json(), fixture("amendment", "appended-by-runs-mjs"));
    const [decision] = readJsonl(join(dir, "decisions.jsonl"));
    assert.equal(decision.source, "operator");
    assert.deepEqual(decision.refs, ["A001", "M2", "M3"]);
    assert.equal(
      readJsonl(join(dir, "events.jsonl")).at(-1).type,
      "amendment.applied"
    );
  });
});

describe("pr-body", () => {
  test("renders the body from the run artifacts, per pr.body_sections", () => {
    const dir = createRun();
    cli([
      "decision",
      "--run-dir",
      dir,
      "--json",
      JSON.stringify({
        phase: "build",
        source: "agent",
        risk: "medium",
        decision: "Use a session cookie",
        rationale: "B-Decide"
      })
    ]);
    const body = cli([
      "pr-body",
      "--run-dir",
      dir,
      "--summary",
      "Fixes the login timeout."
    ]).stdout;
    assert.match(
      body,
      /^## Summary\n\nFixes the login timeout\.\n\n## Decisions\n\n- D001 \(medium\): Use a session cookie/
    );
    assert.match(body, /Generated with \[Claude Code\]/);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        pr: { attribution: false, body_sections: ["decisions"] }
      })
    );
    const out = cli([
      "pr-body",
      "--run-dir",
      dir,
      "--summary",
      "x",
      "--out",
      join(dir, "pr-body.md")
    ]).json();
    assert.equal(out.body_from_run, true);
    const written = readFileSync(join(dir, "pr-body.md"), "utf8");
    assert.equal(
      written,
      "## Decisions\n\n- D001 (medium): Use a session cookie\n"
    );
  });
});

describe("index", () => {
  function seed() {
    const runs = join(root, "runs");
    const make = (name, run, children = {}) => {
      const dir = join(runs, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({
          contract_version: 1,
          id: name,
          type: "skill",
          started_at: NOW,
          ...run
        })
      );
      writeFileSync(join(dir, "summary.md"), "not read by index");
      writeFileSync(join(dir, "events.jsonl"), "not json");
      for (const [child, childRun] of Object.entries(children)) {
        const cdir = join(dir, "tasks", child);
        mkdirSync(cdir, { recursive: true });
        writeFileSync(
          join(cdir, "run.json"),
          JSON.stringify({
            contract_version: 1,
            id: child,
            type: "workflow",
            started_at: NOW,
            ...childRun
          })
        );
      }
    };
    make("2026-11-01-alpha", {
      status: "merged",
      repo: "acme/web",
      max_risk: "low"
    });
    make("2026-11-05-beta", {
      status: "halted",
      repo: "acme/api",
      max_risk: "high"
    });
    make(
      "2026-11-09-epic",
      { type: "overseer", status: "running", repo: null, max_risk: "medium" },
      { "T01-child": { status: "done", repo: "acme/web", max_risk: "medium" } }
    );
    mkdirSync(join(runs, "not-a-run"), { recursive: true });
    mkdirSync(join(runs, "2026-11-10-empty"), { recursive: true });
    return runs;
  }

  test("filters by date range from directory names", () => {
    const runs = seed();
    const ids = (out) => out.runs.map((r) => r.id);
    assert.deepEqual(ids(indexRuns([runs])), [
      "2026-11-01-alpha",
      "2026-11-05-beta",
      "2026-11-09-epic",
      "T01-child"
    ]);
    assert.deepEqual(
      ids(indexRuns([runs], { since: "2026-11-02", until: "2026-11-05" })),
      ["2026-11-05-beta"]
    );
  });

  test("filters by repo, status and risk", () => {
    const runs = seed();
    const ids = (filters) => indexRuns([runs], filters).runs.map((r) => r.id);
    assert.deepEqual(ids({ repo: "web" }), ["2026-11-01-alpha", "T01-child"]);
    assert.deepEqual(ids({ repo: "acme/api" }), ["2026-11-05-beta"]);
    assert.deepEqual(ids({ status: "merged,done" }), [
      "2026-11-01-alpha",
      "T01-child"
    ]);
    assert.deepEqual(ids({ risk: "medium" }), [
      "2026-11-05-beta",
      "2026-11-09-epic",
      "T01-child"
    ]);
    assert.deepEqual(ids({ risk: "high" }), ["2026-11-05-beta"]);
    const child = indexRuns([runs], { status: "done" }).runs[0];
    assert.equal(child.parent, "2026-11-09-epic");
    assert.equal(child.date, "2026-11-09");
  });

  test("reads no file other than run.json, and skips out-of-range runs unread", () => {
    const runs = seed();
    const read = [];
    const fs = {
      existsSync,
      readdirSync,
      statSync,
      readFileSync: (path, enc) => {
        read.push(path);
        return readFileSync(path, enc);
      }
    };
    indexRuns(
      [runs],
      { since: "2026-11-05", status: "halted", repo: "api", risk: "high" },
      fs
    );
    assert.ok(read.length > 0);
    for (const path of read) assert.match(path, /run\.json$/);
    assert.ok(!read.some((p) => p.includes("alpha")));
  });

  test("CLI defaults to recap.roots and runs.root, and supports --last", () => {
    const runs = seed();
    const other = join(root, "other");
    mkdirSync(join(other, "2026-11-08-gamma"), { recursive: true });
    writeFileSync(
      join(other, "2026-11-08-gamma", "run.json"),
      JSON.stringify({
        contract_version: 1,
        id: "2026-11-08-gamma",
        type: "skill",
        status: "done",
        started_at: NOW
      })
    );
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ runs: { root: runs }, recap: { roots: [other] } })
    );
    const out = cli(["index", "--last", "3d"]);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(
      out.json().runs.map((r) => r.id),
      ["2026-11-08-gamma", "2026-11-09-epic", "T01-child"]
    );
    assert.equal(cli(["index", "--root", runs, "--risk", "extreme"]).code, 2);
  });
});

describe("validate", () => {
  test("infers the artifact from the file name", () => {
    const dir = createRun();
    for (const file of ["run.json", "events.jsonl"]) {
      const out = cli(["validate", join(dir, file)]);
      assert.equal(out.code, 0, out.stdout);
      assert.equal(out.json().valid, true);
    }
    const summary = join(
      FIXTURES,
      "summary-frontmatter",
      "valid",
      "summary.md"
    );
    assert.equal(
      cli(["validate", summary]).json().artifact,
      "summary-frontmatter"
    );
    assert.equal(cli(["validate", summary]).code, 0);
  });

  test("reports invalid lines and broken event sequences", () => {
    const dir = createRun();
    writeFileSync(
      join(dir, "events.jsonl"),
      `${readFileSync(join(dir, "events.jsonl"), "utf8")}{"seq":5,"at":"${NOW}","run":"r","type":"pr.opened"}\n`
    );
    const out = cli(["validate", join(dir, "events.jsonl")]);
    assert.equal(out.code, 1);
    assert.deepEqual(out.json().errors, [
      { line: 2, path: "seq", message: "expected 2, got 5" }
    ]);
    // Blank lines are only allowed at the end, and seq counts physical lines.
    const fresh = createRun();
    const lines = readFileSync(join(fresh, "events.jsonl"), "utf8");
    writeFileSync(
      join(fresh, "events.jsonl"),
      `${lines}\n{"seq":2,"at":"${NOW}","run":"r","type":"pr.opened"}\n\n`
    );
    assert.deepEqual(
      cli(["validate", join(fresh, "events.jsonl")]).json().errors,
      [
        { line: 2, path: "(root)", message: "blank line inside a jsonl file" },
        { line: 3, path: "seq", message: "expected 3, got 2" }
      ]
    );
    const bare = join(root, "x.json");
    writeFileSync(bare, "{}");
    assert.equal(cli(["validate", bare]).code, 2);
    assert.equal(cli(["validate", bare, "--schema", "result"]).code, 1);
  });
});
