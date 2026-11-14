import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ShipError } from "../lib/ship/state.mjs";
import { decideWorkspace } from "../lib/ship/workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "ship.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const NOW = "2026-11-08T12:00:00.000Z";

let tmp;
let home;
let origin;
let repo;
let runDir;

function cli(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ESP_SKILLS_HOME: home, ESP_RUNS_NOW: NOW }
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout)
  };
}

const ship = (...args) => cli(SCRIPT, [...args, "--run-dir", runDir]);
const state = () => JSON.parse(readFileSync(join(runDir, "ship.json"), "utf8"));
const jsonl = (name) =>
  existsSync(join(runDir, name))
    ? readFileSync(join(runDir, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function gitIn(cwd, ...args) {
  const r = spawnSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args],
    { cwd, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const git = (...args) => gitIn(repo, ...args);

function commit(file, text, message) {
  writeFileSync(join(repo, file), text);
  git("add", file);
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}

function init(...extra) {
  const r = ship(
    "init",
    "--request",
    "Add OAuth login",
    "--track",
    "inline",
    "--base",
    "main",
    "--project-dir",
    repo,
    ...extra
  );
  assert.equal(r.code, 0, r.stderr);
  return r.json();
}

function workspace(...args) {
  const r = ship("workspace", ...args);
  assert.equal(r.code, 0, r.stderr);
  return r.json();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "esp-ship-ws-"));
  home = join(tmp, "home");
  origin = join(tmp, "origin.git");
  repo = join(tmp, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      worktrees: { root: join(tmp, "worktrees") }
    })
  );
  gitIn(tmp, "init", "-q", "--bare", "-b", "main", origin);
  git("init", "-q", "-b", "main");
  commit("a.txt", "a\n", "init");
  git("remote", "add", "origin", origin);
  git("push", "-q", "-u", "origin", "main");
  const created = cli(RUNS, [
    "create",
    "oauth",
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

describe("decideWorkspace", () => {
  const facts = (extra = {}) => ({
    current: "main",
    base: "main",
    default_branch: "main",
    dirty: [],
    branch: null,
    local: false,
    remote: false,
    ...extra
  });

  test("on the base, a new branch needs a name", () => {
    const d = decideWorkspace(facts());
    assert.equal(d.workspace, "checkout");
    assert.equal(d.action, "name-branch");
  });

  test("a current feature branch is used as is", () => {
    const d = decideWorkspace(facts({ current: "feature/x" }));
    assert.equal(d.workspace, "existing-branch");
    assert.equal(d.action, "use");
    assert.equal(d.branch, "feature/x");
  });

  test("an unknown base never uses the current branch as is", () => {
    const d = decideWorkspace(
      facts({ current: "develop", base: null, default_branch: null })
    );
    assert.equal(d.action, "name-branch");
    assert.match(d.reason, /base is unknown/);
  });

  test("--worktree on a clean tree already on --branch works in place", () => {
    const d = decideWorkspace(
      facts({ current: "feature/x", branch: "feature/x", local: true }),
      { useWorktree: true }
    );
    assert.equal(d.workspace, "existing-branch");
    assert.equal(d.action, "use");
  });

  test("--branch: local, remote and new", () => {
    assert.equal(
      decideWorkspace(facts({ branch: "feature/x", local: true })).action,
      "checkout"
    );
    const remote = decideWorkspace(
      facts({ branch: "feature/x", remote: true })
    );
    assert.equal(remote.workspace, "existing-branch");
    assert.equal(remote.location, "remote");
    const fresh = decideWorkspace(facts({ branch: "feature/x" }));
    assert.equal(fresh.workspace, "checkout");
    assert.equal(fresh.action, "create");
  });

  test("a dirty tree goes to a worktree, or fails", () => {
    const dirty = facts({ dirty: ["a.txt"] });
    assert.equal(decideWorkspace(dirty).workspace, "worktree");
    assert.equal(decideWorkspace(dirty).action, "name-branch");
    assert.equal(
      decideWorkspace({ ...dirty, branch: "feature/x" }).action,
      "worktree"
    );
    assert.throws(
      () => decideWorkspace(dirty, { dirtyTree: "fail" }),
      ShipError
    );
    assert.throws(
      () =>
        decideWorkspace({
          ...dirty,
          current: "feature/x",
          branch: "feature/x"
        }),
      /would mix/
    );
    assert.throws(
      () => decideWorkspace(dirty, { dirtyTree: "stash" }),
      ShipError
    );
  });

  test("--worktree on a clean tree", () => {
    const d = decideWorkspace(facts({ branch: "feature/x" }), {
      useWorktree: true
    });
    assert.equal(d.workspace, "worktree");
    assert.equal(d.location, "new");
  });
});

describe("ship.mjs workspace", () => {
  test("new branch: name-branch, then created from origin/main", () => {
    init();
    const first = workspace();
    assert.equal(first.action, "name-branch");
    assert.equal(first.kind, "checkout");
    // Local main is ahead of origin: the new branch starts from origin/main.
    commit("b.txt", "b\n", "local only");
    const out = workspace("--branch", "feature/oauth");
    assert.equal(out.action, "create");
    assert.equal(out.kind, "checkout");
    assert.equal(git("branch", "--show-current"), "feature/oauth");
    assert.equal(out.base_sha, git("rev-parse", "origin/main"));
    const s = state();
    assert.equal(s.branch, "feature/oauth");
    assert.equal(s.workspace.kind, "checkout");
    assert.ok(jsonl("events.jsonl").some((e) => e.type === "branch.created"));
    // A second call returns the recorded workspace.
    const again = workspace();
    assert.equal(again.action, "use");
    assert.equal(again.created, false);
  });

  test("existing local branch is checked out", () => {
    git("switch", "-qc", "feature/local");
    commit("b.txt", "b\n", "work");
    git("switch", "-q", "main");
    init();
    const out = workspace("--branch", "feature/local");
    assert.equal(out.kind, "existing-branch");
    assert.equal(out.location, "local");
    assert.equal(git("branch", "--show-current"), "feature/local");
    assert.equal(out.base_sha, git("merge-base", "HEAD", "origin/main"));
    const decision = jsonl("decisions.jsonl").at(-1);
    assert.equal(decision.phase, "branch");
    assert.match(decision.decision, /existing branch feature\/local/);
  });

  test("existing remote branch is tracked from origin", () => {
    git("switch", "-qc", "feature/remote");
    const head = commit("b.txt", "b\n", "remote work");
    git("push", "-q", "origin", "feature/remote");
    git("switch", "-q", "main");
    git("branch", "-q", "-D", "feature/remote");
    init();
    const out = workspace("--branch", "feature/remote");
    assert.equal(out.kind, "existing-branch");
    assert.equal(out.location, "remote");
    assert.equal(git("rev-parse", "HEAD"), head);
    assert.equal(
      git("rev-parse", "--abbrev-ref", "feature/remote@{upstream}"),
      "origin/feature/remote"
    );
  });

  test("current feature branch is used as is", () => {
    git("switch", "-qc", "feature/current");
    commit("b.txt", "b\n", "work");
    init();
    const out = workspace();
    assert.equal(out.kind, "existing-branch");
    assert.equal(out.action, "use");
    assert.equal(out.branch, "feature/current");
    assert.equal(state().base_sha, git("rev-parse", "main"));
  });

  test("dirty tree goes to a task worktree and keeps the changes", () => {
    init();
    writeFileSync(join(repo, "a.txt"), "edited\n");
    writeFileSync(join(repo, "notes.txt"), "mine\n");
    const first = workspace();
    assert.equal(first.kind, "worktree");
    assert.equal(first.action, "name-branch");
    assert.deepEqual(first.dirty_files.sort(), ["a.txt", "notes.txt"]);
    const out = workspace("--branch", "feature/oauth");
    assert.equal(out.action, "worktree");
    assert.ok(existsSync(join(out.worktree, "a.txt")));
    assert.equal(readFileSync(join(out.worktree, "a.txt"), "utf8"), "a\n");
    assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "edited\n");
    assert.equal(git("branch", "--show-current"), "main");
    const s = state();
    assert.equal(s.worktree, out.worktree);
    assert.equal(s.project_dir, out.worktree);
    assert.equal(s.workspace.kind, "worktree");
    assert.equal(ship("next").json().cwd, out.worktree);
    const decisions = jsonl("decisions.jsonl").filter(
      (d) => d.phase === "branch"
    );
    assert.equal(decisions.length, 1, "logged once across both calls");
    assert.equal(decisions[0].source, "policy");
    assert.deepEqual(decisions[0].files.sort(), ["a.txt", "notes.txt"]);
    const result = ship("result").json();
    assert.equal(result.outputs.workspace.kind, "worktree");
    assert.equal(result.outputs.workspace.worktree, out.worktree);
    gitIn(repo, "worktree", "remove", "--force", out.worktree);
  });

  test("dirty tree with ship.dirty_tree fail stops", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ version: 1, ship: { dirty_tree: "fail" } })
    );
    init();
    writeFileSync(join(repo, "a.txt"), "edited\n");
    const r = ship("workspace");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /dirty_tree is fail/);
    assert.equal(state().branch, null);
  });

  test("dirty tree with --branch set to the current branch stops", () => {
    git("switch", "-qc", "feature/current");
    init();
    writeFileSync(join(repo, "a.txt"), "edited\n");
    const r = ship("workspace", "--branch", "feature/current");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /would mix/);
  });

  test("a branch name git would read as an option is refused", () => {
    init();
    const r = ship("workspace", "--branch=--upload-pack=x");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a valid branch name/);
    assert.equal(state().branch, null);
  });
});
