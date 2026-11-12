// Workspace of a run: the task worktree under worktrees.root. Existing
// branches and a dirty tree are handled on top of this module.

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expandHome } from "../../config.mjs";
import { appendEvent, cmdUpdate } from "../../runs.mjs";
import {
  configOf,
  git,
  readState,
  runDirOf,
  runJson,
  ShipError,
  stringOption,
  tryGit,
  updateState
} from "./state.mjs";

/** Create the task worktree under worktrees.root, on a new branch from `from`. */
export function cmdWorktree(options, env = process.env) {
  const dir = runDirOf(options);
  const state = readState(dir);
  const branch = stringOption(options.branch);
  if (!branch) throw new ShipError("worktree needs --branch <name>", 2);
  if (state.worktree)
    return { path: state.worktree, branch: state.branch, created: false };
  const config = configOf(state.config_snapshot);
  const root = resolve(
    expandHome(String(config.worktrees?.root ?? "~/.esp-skills/worktrees"))
  );
  const path = join(root, runJson(dir).id);
  mkdirSync(dirname(path), { recursive: true });
  const from =
    stringOption(options.from) ?? (state.base ? `origin/${state.base}` : "HEAD");
  const exists = tryGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    state.repo_dir
  );
  if (exists) git(["worktree", "add", path, branch], state.repo_dir);
  else git(["worktree", "add", "-b", branch, path, from], state.repo_dir);
  const baseSha = git(["rev-parse", "HEAD"], path).trim();
  const updated = updateState(
    dir,
    (s) => {
      s.worktree = path;
      s.project_dir = path;
      s.branch = branch;
      if (!exists) s.base_sha = baseSha;
    },
    env
  );
  appendEvent(
    dir,
    "branch.created",
    {
      branch: updated.branch,
      base: updated.base,
      base_sha: updated.base_sha,
      worktree: path
    },
    env
  );
  cmdUpdate({ "run-dir": dir, branch: updated.branch }, env);
  return {
    path,
    branch: updated.branch,
    base_sha: updated.base_sha,
    created: true,
    reused_branch: Boolean(exists)
  };
}
