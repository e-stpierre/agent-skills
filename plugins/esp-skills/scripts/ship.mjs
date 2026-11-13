#!/usr/bin/env node
// esp-skills state and dispatch for esp-ship.
//
// esp-ship takes a task from request to merged pull request on one of two
// tracks: inline (one session, one commit) or orchestrated (a plan, milestone
// builders and verifiers, an internal review). Both tracks share the same
// tail: pull request, review wait and fix rounds, body refresh, merge. This
// script keeps everything deterministic out of the model: the phases of the
// track and what to run next, the loops, the limits and budgets, the track
// switch and the caller hand-off, the task worktree, the milestone state, the
// pull request body built from the run artifacts, and the final result block.
// State lives in <run-dir>/ship.json and, for the milestones, in
// <run-dir>/state.json, so an interrupted run resumes.
//
// The logic lives in lib/ship/: state, phases, review-loop, tail, inline,
// milestones, gates, workspace, triage and review-gate.
//
// Exit codes: 0 ok, 1 failure or invalid state, 2 usage. `escalate`, `halt`
// and `result` exit with the contract code of their result status (0 done or
// merged, 10 awaiting-human, 20 halted, 30 escalate, 1 failed).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exitCodeFor } from "./lib/contract.mjs";
import {
  cmdEscalate,
  cmdGateFailure,
  cmdScope,
  cmdSwitchTrack
} from "./lib/ship/inline.mjs";
import {
  cmdAgent,
  cmdFinish,
  cmdMilestoneGates,
  cmdMilestoneInit,
  cmdMilestoneNext,
  cmdModels,
  cmdReuse,
  cmdStart,
  readMilestoneState
} from "./lib/ship/milestones.mjs";
import {
  budgetCheck,
  cmdInit,
  cmdNext,
  cmdPhase,
  cmdStop
} from "./lib/ship/phases.mjs";
import { reviewLoop } from "./lib/ship/review-loop.mjs";
import { readState, runDirOf, ShipError } from "./lib/ship/state.mjs";
import { cmdHalt, cmdPrBody, cmdPrLoop, cmdResult } from "./lib/ship/tail.mjs";
import { cmdFinalGates } from "./lib/ship/gates.mjs";
import { cmdReviewGate } from "./lib/ship/review-gate.mjs";
import { cmdTriage } from "./lib/ship/triage.mjs";
import { cmdWorkspace, cmdWorktree } from "./lib/ship/workspace.mjs";
import { now } from "./runs.mjs";

export { ShipError };

const USAGE = `Usage: node ship.mjs <command> [args] --run-dir <path> [options]

Commands:
  triage               Before init: detect the request (--request <text|path|issue>) and pick the
                       plan source and the track: { input_kind, plan_source, track, nothing_to_do,
                       needs_judgment, packages, ... }. --track pins the track; for a prompt or an
                       issue, --judged-track inline|orchestrated --estimate <files> --reason <text>
                       passes the model's judgment. --plan-mode auto|skip|always changes the plan
                       of a prompt or an issue. --record (needs --run-dir) logs one decision per
                       choice and writes the triage step result
  init                 Create ship.json (--request <text> --track inline|orchestrated --base <branch>);
                       resolves the phases of the track and freezes the config. A second call
                       prints the state; --resume lifts an awaiting-human stop, or takes over
                       an escalated caller-owned run on the orchestrated track
  show                 Print ship.json
  next                 What to run now: { action, track, phase, sub, skill, role, model, effort, cwd, ... }
  phase <name>         Record a phase: --status started|done|skipped|failed, and its facts
                       (--plan <file>, --branch, --base, --base-sha, --commit, --pr, --summary,
                       --gates <json>, --reason)
  final-gates          Record one run of the full gates in the main tree (--result pass|fail
                       [--gates <json>] [--reason <text>]): continue, fix (one fixer round),
                       halt (gates-exhausted) or continue-failing
  review-gate          After the build, review_mode auto: decide the internal review from the
                       diff (files, lines), the milestone complexities, max_risk and
                       ship.review.always_paths; a skip marks the review phase skipped. Logs
                       one policy decision; later calls print the recorded gate
  review-loop          Internal review loop state: review, fix, done, stop or halt
  pr-loop              Pull request rounds after a step (--after wait|fix): wait, fix, merge or stop
  workspace            Branch phase: pick the workspace (checkout, existing-branch, worktree) from
                       --branch <name>, the current branch, the dirty files and ship.dirty_tree,
                       and apply it; without a branch name it may return action name-branch
  worktree             Create the task worktree on --branch <name> (from --from, default origin/<base>)
  budget               Elapsed wall time vs the track's max_wall_minutes
  scope                Inline track: changed files since the base vs max_files_changed
                       (--estimate <n> checks a planned file count instead)
  gate-failure         Inline track: count a gate failure (--reason); the second escalates, or halts
  switch-track         Owned inline run: move to the orchestrated track in place (--to orchestrated
                       --trigger files|design|gates --reason <text>); logs the Escalate decision
  escalate             Caller-owned inline run: hand the task to the caller (--trigger files|design|gates
                       --reason <text> [--question <text>] [--keep-tree]): saves escalation.patch,
                       stashes the work, logs the decision, prints the escalate block (exit 30)
  stop                 Record a stop (--status awaiting-human|failed|halted --reason <text>)
  halt                 Halt under a halt_on key (--key --reason), log it, print the halted block (exit 20)
  pr-body              Pull request body from the run artifacts (--summary <text>, --out <file>)
  result               Final result block (--status, --summary); exits with its contract code
  milestone <cmd>      Milestone state (state.json) of the orchestrated track:
    init               Create state.json from the latest plan (or --plan), or sync it with an
                       amended plan; uses the run's frozen config
    next               What to run now: { action: run|retry|halt|done|blocked, milestone, batch }
                       (--milestone <id|next> for one milestone, --parallel for a batch)
    start <id>         Begin an attempt of a milestone (emits iteration.started)
    finish <id>        End the attempt: --status done|failed|halted [--commit <sha>] [--reason <text>]
    models <id>        Builder and verifier { model, effort } (--model <alias> [--effort <level>])
    reuse <id>         Continue the last builder with a milestone or spawn a fresh one:
                       { decision: reuse|fresh, agent_id, reason, used, cost, limit }; logs a
                       policy decision (--agent-id <id> held by this session, --single in
                       --milestone mode, --parallel, --model, --effort)
    agent <id>         Record the builder agent of the current attempt (--agent-id <id>
                       [--tokens <n> reported by the Agent result] [--worktree])
    gates              Gate commands: configured, else detected from --project-dir, and the
                       checks of a scope: --milestone <id> (its validation commands plus
                       ship.gates.always, else the full gates) or --files <a,b> (a fix round:
                       the milestones covering those files); --scope milestone|full
    show               Print state.json

Options:
  --run-dir <path>          Run directory (required except by milestone gates)
  --config-snapshot <path>  Config snapshot (init; later commands use the frozen one)
  --project-dir <dir>       Repository root (default: recorded at init, else the git root)
  --track <track>           init, triage: inline or orchestrated (init default: orchestrated)
  --request <text>          init, triage: the task, an issue reference or a file path
  --record                  triage: log the decisions and write the triage step result
  --caller-owned            init: the caller owns the run, so an inline escalation ends with exit 30
  --plan-source <source>    init: reuse, import, generate or synthesize the plan (default: reuse
                            a plan in the run directory, else generate)
  --plan-mode <mode>        init, triage: auto, skip or always (default: ship.plan_mode)
  --review-mode <mode>      init: auto, internal, pr, both or none (default: ship.review_mode)
  --no-pr, --no-merge       init: stop before the pull request, or before the merge
  --stop-before-wait        init: leave the review wait, fix-review and merge to the caller
  --resume                  init: resume the run (see init)
  --worktree                init: work in a task worktree (default: ship.worktree)
  --branch <name>           workspace: the task branch (checked out, tracked from origin or created)
  --max-rounds <n>          init: pull request fix rounds (default: fix-review.max_rounds)
  --interactive <mode>      init: off, plan or all (default: defaults.interactive)
  --reviewers <names>       init: reviewers to wait for and fix
  --help                    Show this help`;

const BOOLEAN_FLAGS = new Set([
  "no-pr",
  "no-merge",
  "worktree",
  "resume",
  "stop-before-wait",
  "caller-owned",
  "record",
  "keep-tree",
  "parallel",
  "single",
  "help"
]);

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") options.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (BOOLEAN_FLAGS.has(key))
        options[key] = eq === -1 ? true : arg.slice(eq + 1) !== "false";
      else {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined)
          throw new ShipError(`--${key} requires a value`, 2);
        options[key] = value;
      }
    } else positional.push(arg);
  }
  return { command: positional[0], args: positional.slice(1), options };
}

const blockOutput = (block) => ({
  output: JSON.stringify(block),
  exitCode: exitCodeFor(block.status)
});

function runMilestone(sub, args, options, env) {
  switch (sub) {
    case "init":
      return { output: cmdMilestoneInit(options, env) };
    case "next":
      return { output: cmdMilestoneNext(options) };
    case "start":
      return { output: cmdStart(args[0], options, env) };
    case "finish":
      return { output: cmdFinish(args[0], options, env) };
    case "models":
      return { output: cmdModels(args[0], options) };
    case "reuse":
      return { output: cmdReuse(args[0], options, env) };
    case "agent":
      return { output: cmdAgent(args[0], options, env) };
    case "gates":
      return { output: cmdMilestoneGates(options) };
    case "show":
      return { output: readMilestoneState(runDirOf(options)) };
    default:
      throw new ShipError(
        `Unknown milestone command: ${sub ?? "(missing)"}\n\n${USAGE}`,
        2
      );
  }
}

export function run(argv, env = process.env) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command)
    return { output: USAGE, exitCode: options.help ? 0 : 2 };
  switch (command) {
    case "triage":
      return { output: cmdTriage(options, env) };
    case "init":
      return { output: cmdInit(options, env) };
    case "show":
      return { output: readState(runDirOf(options)) };
    case "next":
      return { output: cmdNext(options, env) };
    case "phase":
      return { output: cmdPhase(args[0], options, env) };
    case "final-gates":
      return { output: cmdFinalGates(options, env) };
    case "review-gate":
      return { output: cmdReviewGate(options, env) };
    case "review-loop": {
      const dir = runDirOf(options);
      return { output: reviewLoop(dir, readState(dir)) };
    }
    case "pr-loop":
      return { output: cmdPrLoop(options, env) };
    case "workspace":
      return { output: cmdWorkspace(options, env) };
    case "worktree":
      return { output: cmdWorktree(options, env) };
    case "budget":
      return { output: budgetCheck(readState(runDirOf(options)), now(env)) };
    case "scope":
      return { output: cmdScope(options) };
    case "gate-failure":
      return { output: cmdGateFailure(options, env) };
    case "switch-track":
      return { output: cmdSwitchTrack(options, env) };
    case "escalate":
      return blockOutput(cmdEscalate(options, env));
    case "stop":
      return { output: cmdStop(options, env) };
    case "halt":
      return blockOutput(cmdHalt(options, env));
    case "pr-body":
      return { output: cmdPrBody(options) };
    case "result":
      return blockOutput(cmdResult(options));
    case "milestone":
      return runMilestone(args[0], args.slice(1), options, env);
    default:
      throw new ShipError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

const KNOWN_ERRORS = new Set([
  "ShipError",
  "ConfigError",
  "RunsError",
  "LockTimeoutError",
  "PlanError"
]);

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const known = KNOWN_ERRORS.has(err.name);
    process.stderr.write(
      `ship error: ${known ? err.message : (err.stack ?? err)}\n`
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
