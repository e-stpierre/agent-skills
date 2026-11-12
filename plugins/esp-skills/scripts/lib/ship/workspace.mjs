// Workspace of a run: the branch the task works on and the working directory.
//
// `ship.mjs workspace` runs at the start of the branch phase. It reads the
// checkout (current branch, dirty files, local and remote branches) and picks
// one of three workspaces:
//
// - checkout: a new branch in the main checkout
// - existing-branch: a branch that already exists (--branch, or the current
//   feature branch), checked out as is
// - worktree: a task worktree under worktrees.root, because of --worktree or
//   because the main checkout is dirty (ship.dirty_tree: worktree). The dirty
//   files stay untouched in the main checkout
//
// With a branch name it applies the choice. Without one, when the task needs a
// new branch, it returns `action: name-branch` and the skill picks the name
// (branch.pattern) before calling again with --branch.

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expandHome } from "../../config.mjs";
import { appendDecision, appendEvent, cmdUpdate } from "../../runs.mjs";
import {
  configOf,
  git,
  lines,
  readState,
  runDirOf,
  runJson,
  ShipError,
  stringOption,
  tryGit,
  updateState
} from "./state.mjs";

export const WORKSPACES = ["checkout", "existing-branch", "worktree"];
export const DIRTY_TREE_MODES = ["worktree", "fail"];

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const trimmed = (text) => (text === null ? null : text.trim() || null);

/** Paths of `git status --porcelain` (the new path of a rename). */
export function dirtyFiles(repoDir) {
  return lines(
    git(["status", "--porcelain", "--untracked-files=all"], repoDir)
  ).map((line) => {
    const path = line.replace(/^\S+\s+/, "");
    const arrow = path.indexOf(" -> ");
    return (arrow === -1 ? path : path.slice(arrow + 4)).replace(/^"|"$/g, "");
  });
}

/** Default branch: origin/HEAD, else a local main or master. */
export function defaultBranchOf(repoDir) {
  const head = trimmed(
    tryGit(
      ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
      repoDir
    )
  );
  if (head) return head.replace(/^origin\//, "");
  for (const name of ["main", "master"])
    if (
      tryGit(
        ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
        repoDir
      )
    )
      return name;
  return null;
}

const hasOrigin = (repoDir) =>
  tryGit(["remote", "get-url", "origin"], repoDir) !== null;

const localExists = (repoDir, branch) =>
  tryGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repoDir
  ) !== null;

/** Whether origin has the branch (asks the remote, so a missing fetch does not hide it). */
function remoteExists(repoDir, branch) {
  if (!hasOrigin(repoDir)) return false;
  const out = tryGit(["ls-remote", "--heads", "origin", branch], repoDir);
  return lines(out).some((l) => l.endsWith(`refs/heads/${branch}`));
}

/** The ref a new branch starts from: origin/<base> after a fetch, else <base>, else HEAD. */
function baseRef(repoDir, base) {
  if (!base) return "HEAD";
  if (hasOrigin(repoDir)) {
    tryGit(["fetch", "--quiet", "origin", base], repoDir);
    if (
      tryGit(
        ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`],
        repoDir
      )
    )
      return `origin/${base}`;
  }
  return localExists(repoDir, base) ? base : "HEAD";
}

/** What the workspace decision needs to know about the checkout. */
export function workspaceFacts(repoDir, { base = null, branch = null } = {}) {
  const defaultBranch = defaultBranchOf(repoDir);
  return {
    current: trimmed(
      tryGit(["symbolic-ref", "--short", "-q", "HEAD"], repoDir)
    ),
    base: base ?? defaultBranch,
    default_branch: defaultBranch,
    dirty: dirtyFiles(repoDir),
    branch,
    local: branch ? localExists(repoDir, branch) : false,
    remote: branch ? remoteExists(repoDir, branch) : false
  };
}

// ---------------------------------------------------------------------------
// Decision (pure)
// ---------------------------------------------------------------------------

/**
 * Pick the workspace from the facts. Returns { workspace, action, branch,
 * location, reason }. Actions: `name-branch` (the caller picks a new branch
 * name), `use` (the branch is already checked out here), `checkout` (an
 * existing branch), `create` (a new branch from the base), `worktree` (a task
 * worktree on the branch). Throws when the tree is dirty and cannot be left
 * alone: dirty_tree `fail`, or --branch naming the current branch.
 */
export function decideWorkspace(
  facts,
  { dirtyTree = "worktree", useWorktree = false } = {}
) {
  if (!DIRTY_TREE_MODES.includes(dirtyTree))
    throw new ShipError(
      `ship.dirty_tree must be one of ${DIRTY_TREE_MODES.join(", ")}`,
      2
    );
  const dirty = facts.dirty.length > 0;
  const branch = facts.branch;
  if (dirty && branch && branch === facts.current)
    throw new ShipError(
      `The working tree is dirty and --branch ${branch} is the current branch: the task work would mix with the uncommitted changes. Commit or stash them, or pick another branch`,
      1
    );
  if (dirty && dirtyTree === "fail")
    throw new ShipError(
      `The working tree is dirty (${facts.dirty.length} file(s)) and ship.dirty_tree is fail: commit or stash the changes first`,
      1
    );
  const location = !branch
    ? null
    : facts.local
      ? "local"
      : facts.remote
        ? "remote"
        : "new";
  const reason = dirty
    ? `the working tree is dirty (${facts.dirty.length} file(s)): they stay untouched in the main checkout`
    : useWorktree
      ? "--worktree (or ship.worktree)"
      : null;
  if (dirty || useWorktree)
    return branch
      ? { workspace: "worktree", action: "worktree", branch, location, reason }
      : {
          workspace: "worktree",
          action: "name-branch",
          branch: null,
          location,
          reason
        };
  if (!branch) {
    const feature =
      facts.current &&
      facts.current !== facts.base &&
      facts.current !== facts.default_branch;
    return feature
      ? {
          workspace: "existing-branch",
          action: "use",
          branch: facts.current,
          location: "local",
          reason: `the current branch ${facts.current} is not the base`
        }
      : {
          workspace: "checkout",
          action: "name-branch",
          branch: null,
          location: null,
          reason: facts.current
            ? `the current branch ${facts.current} is the base or the default branch`
            : "detached HEAD"
        };
  }
  if (branch === facts.current)
    return {
      workspace: "existing-branch",
      action: "use",
      branch,
      location,
      reason: `--branch ${branch} is the current branch`
    };
  if (location === "new")
    return {
      workspace: "checkout",
      action: "create",
      branch,
      location,
      reason: `--branch ${branch} does not exist: created from the base`
    };
  return {
    workspace: "existing-branch",
    action: "checkout",
    branch,
    location,
    reason: `--branch ${branch} exists ${location === "local" ? "locally" : "on origin"}`
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function worktreeRoot(config) {
  return resolve(
    expandHome(String(config.worktrees?.root ?? "~/.esp-skills/worktrees"))
  );
}

/** Add the task worktree on `branch`: existing local, tracking origin, or new from `from`. */
function addWorktree(repoDir, path, branch, location, from) {
  mkdirSync(dirname(path), { recursive: true });
  if (location === "local") git(["worktree", "add", path, branch], repoDir);
  else if (location === "remote") {
    git(["fetch", "--quiet", "origin", branch], repoDir);
    git(
      ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`],
      repoDir
    );
  } else git(["worktree", "add", "-b", branch, path, from], repoDir);
}

/** Merge-base of HEAD with the base ref, else HEAD. */
function mergeBase(cwd, ref) {
  return (
    trimmed(tryGit(["merge-base", "HEAD", ref], cwd)) ??
    git(["rev-parse", "HEAD"], cwd).trim()
  );
}

function recordBranch(dir, updated, env) {
  appendEvent(
    dir,
    "branch.created",
    {
      branch: updated.branch,
      base: updated.base,
      base_sha: updated.base_sha,
      worktree: updated.worktree
    },
    env
  );
  cmdUpdate({ "run-dir": dir, branch: updated.branch }, env);
}

function cleanupOf(config) {
  return config.worktrees?.cleanup ?? null;
}

/**
 * `ship.mjs workspace [--branch <name>]`: decide the workspace and, with a
 * branch, apply it. The workspace and its decision are recorded once in
 * ship.json (`workspace`); later calls return the recorded workspace.
 */
export function cmdWorkspace(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const config = configOf(state.config_snapshot);
  const repoDir = state.repo_dir;
  const branchOption = stringOption(options.branch) ?? state.branch;
  if (state.branch && state.workspace?.branch)
    return {
      ...state.workspace,
      action: "use",
      cwd: state.worktree ?? state.project_dir,
      created: false
    };
  const dirtyTree = String(config.ship?.dirty_tree ?? "worktree");
  const facts = workspaceFacts(repoDir, {
    base: state.base,
    branch: branchOption
  });
  const choice = decideWorkspace(facts, {
    dirtyTree,
    useWorktree: state.use_worktree
  });
  const base = facts.base;
  const previous = state.workspace;
  const decision =
    previous?.kind === choice.workspace && previous.decision
      ? previous.decision
      : choice.workspace === "checkout"
        ? null
        : appendDecision(
            dir,
            {
              phase: "branch",
              source:
                choice.workspace === "worktree" && facts.dirty.length > 0
                  ? "policy"
                  : branchOption || state.use_worktree
                    ? "operator"
                    : "policy",
              risk: "low",
              decision:
                choice.workspace === "worktree"
                  ? "Work in a task worktree"
                  : `Work on the existing branch ${choice.branch}`,
              rationale: `Workspace ${choice.workspace}: ${choice.reason}`,
              ...(facts.dirty.length > 0 ? { files: facts.dirty } : {})
            },
            env
          ).id;
  const workspace = {
    kind: choice.workspace,
    branch: null,
    location: choice.location,
    reason: choice.reason,
    dirty_files: facts.dirty,
    worktree: null,
    cleanup: choice.workspace === "worktree" ? cleanupOf(config) : null,
    decision
  };
  if (choice.action === "name-branch") {
    updateState(
      dir,
      (s) => {
        s.base ??= base;
        s.workspace = workspace;
        if (choice.workspace === "worktree") s.use_worktree = true;
      },
      env
    );
    return {
      ...workspace,
      action: "name-branch",
      cwd: repoDir,
      created: false
    };
  }

  const branch = choice.branch;
  let cwd = repoDir;
  let baseSha;
  let worktree = null;
  if (choice.action === "worktree") {
    worktree = join(worktreeRoot(config), runJson(dir).id);
    const from = baseRef(repoDir, base);
    addWorktree(repoDir, worktree, branch, choice.location, from);
    cwd = worktree;
    baseSha =
      choice.location === "new"
        ? git(["rev-parse", "HEAD"], worktree).trim()
        : mergeBase(worktree, from);
  } else if (choice.action === "create") {
    const from = baseRef(repoDir, base);
    git(["checkout", "-q", "-b", branch, from], repoDir);
    baseSha = git(["rev-parse", "HEAD"], repoDir).trim();
  } else {
    if (choice.action === "checkout") {
      if (choice.location === "local") git(["checkout", "-q", branch], repoDir);
      else {
        git(["fetch", "--quiet", "origin", branch], repoDir);
        git(
          ["checkout", "-q", "--track", "-b", branch, `origin/${branch}`],
          repoDir
        );
      }
    }
    baseSha = mergeBase(repoDir, baseRef(repoDir, base));
  }
  workspace.branch = branch;
  workspace.worktree = worktree;
  const updated = updateState(
    dir,
    (s) => {
      s.base ??= base;
      s.branch = branch;
      s.base_sha = baseSha;
      s.workspace = workspace;
      if (worktree) {
        s.worktree = worktree;
        s.project_dir = worktree;
        s.use_worktree = true;
      }
    },
    env
  );
  recordBranch(dir, updated, env);
  return {
    ...workspace,
    action: choice.action,
    base: updated.base,
    base_sha: baseSha,
    cwd,
    created: true
  };
}

// ---------------------------------------------------------------------------
// worktree (explicit)
// ---------------------------------------------------------------------------

/** Create the task worktree under worktrees.root, on a new branch from `from`. */
export function cmdWorktree(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const branch = stringOption(options.branch);
  if (!branch) throw new ShipError("worktree needs --branch <name>", 2);
  if (state.worktree)
    return { path: state.worktree, branch: state.branch, created: false };
  const config = configOf(state.config_snapshot);
  const path = join(worktreeRoot(config), runJson(dir).id);
  const from =
    stringOption(options.from) ??
    (state.base ? `origin/${state.base}` : "HEAD");
  const exists = localExists(state.repo_dir, branch);
  addWorktree(state.repo_dir, path, branch, exists ? "local" : "new", from);
  const baseSha = git(["rev-parse", "HEAD"], path).trim();
  const updated = updateState(
    dir,
    (s) => {
      s.worktree = path;
      s.project_dir = path;
      s.branch = branch;
      if (!exists) s.base_sha = baseSha;
      s.workspace ??= {
        kind: "worktree",
        branch,
        location: exists ? "local" : "new",
        reason: "--worktree (or ship.worktree)",
        dirty_files: [],
        worktree: path,
        cleanup: cleanupOf(config),
        decision: null
      };
    },
    env
  );
  recordBranch(dir, updated, env);
  return {
    path,
    branch: updated.branch,
    base_sha: updated.base_sha,
    created: true,
    reused_branch: exists
  };
}
