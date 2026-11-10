# Decision Policy

The rules every esp-skills workflow skill and agent follows when it meets a choice: a review finding, a review comment, an ambiguous plan step, a failing gate. One policy means a fixer can act without asking, a user can predict what an autonomous run will do, and a harness can route the remaining questions.

## Classes

Classify every item before acting on it. When an item fits several classes, take the most restrictive one (Halt, then B-Scope, then B-Decide, then A-Fix). Reject only applies when the item itself is wrong.

| Class    | Meaning                                                            | Interactive        | Autonomous                                     |
| -------- | ------------------------------------------------------------------ | ------------------ | ---------------------------------------------- |
| A-Fix    | Clear issue, one clear fix                                         | Show and recommend | Fix                                            |
| B-Decide | Valid issue, several reasonable options                            | Ask                | Apply the recommended option, log it           |
| B-Scope  | Changes scope, a public API, the data model, or product behavior   | Ask                | Defer per `fix-review.deferred_items`, log it  |
| Reject   | Invalid, outdated, already handled, or contradicts the conventions | Show the reason    | Reply with the reason (PR) or drop it, log it  |
| Halt     | A stop condition is met (see Stop Conditions)                      | Ask                | Stop this task, write the summary, never merge |

- **A-Fix**: the fix is local, the expected behavior is not in doubt, and the change stays inside the task's scope. Fixing a typo, a missing null check, a wrong test assertion, or a convention violation the repo documents.
- **B-Decide**: the issue is real, but two or more fixes are defensible and none changes scope. Pick the option that best fits the plan, the repo conventions, and the smallest diff. Record the rejected options as `alternatives`.
- **B-Scope**: acting would change what the task delivers: a new feature, a renamed or removed public API, a schema or migration change, a behavior users would notice. Never apply a B-Scope item autonomously.
- **Reject**: the item is wrong for a stated reason: the code already handles it, the comment targets an older revision, it contradicts `AGENTS.md` or the plan, or it is a style preference the repo does not enforce. A Reject always carries the reason.
- **Halt**: continuing would be unsafe or wasteful. Halting is not failure: it hands the task back with a summary.

## Interactive Modes

`--interactive[=off|plan|all]` selects when a skill stops to ask. The default comes from `defaults.interactive` (`off`).

| Mode   | Asks at                                                                  | Everything else |
| ------ | ------------------------------------------------------------------------ | --------------- |
| `off`  | Never. B-Decide applies the recommendation, B-Scope defers, Halt stops   | Autonomous      |
| `plan` | Plan approval only                                                       | Autonomous      |
| `all`  | Plan approval, review findings (A and B groups), fix-review recap, merge | Interactive     |

- In standalone interactive mode, "Ask" uses the session's question tool (for example `AskUserQuestion`) with the recommended option listed first.
- Headless sessions (`claude -p`, harness steps, subagents) are always `off`, whatever the flag says. Subagents never ask: they return the question to their caller.

## Asking Under a Harness

When a skill runs with `--run-dir` and is headless, "Ask" becomes a `needs_input` request in the result block. The step ends with `status: awaiting-human` and exit code 10:

```json
{
  "status": "awaiting-human",
  "summary": "Review found a public API change that needs a decision.",
  "needs_input": {
    "id": "Q1",
    "question": "Rename getUser() to fetchUser() as the reviewer suggests?",
    "options": [
      {
        "id": "keep",
        "label": "Keep getUser()",
        "description": "No API change"
      },
      {
        "id": "rename",
        "label": "Rename",
        "description": "Breaking for callers"
      }
    ],
    "recommended": "keep",
    "context": "Comment https://github.com/o/r/pull/12#discussion_r1; 3 call sites",
    "blocking": true
  }
}
```

- **B-Decide** requests set `blocking: false` and always set `recommended`: the harness may apply it after its timeout.
- **B-Scope** and **Halt** requests set `blocking: true`.
- Before ending with `needs_input`, finish every item that does not depend on the answer, and log those decisions.
- The answer comes back as an operator message. Log it with `source: operator` (`runs.mjs deliver` does this) and continue.

Without `--run-dir`, a headless skill that would ask applies the autonomous column instead.

## Stop Conditions

`go.halt_on` lists the stop conditions a workflow honors. Each key maps to one condition:

| Key                  | Condition                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `critical-security`  | 🔴 A critical security or data-loss finding that cannot be fixed with high confidence                        |
| `gates-exhausted`    | Gates still fail after `build.max_retries_per_milestone` retries                                             |
| `scope-change`       | Plan ambiguity, or a B-Scope item, that changes scope or a public API and cannot be deferred                 |
| `destructive-action` | A destructive or irreversible action: shared-data migration, force push to a shared branch, deletion of data |
| `budget`             | A configured budget is exhausted (milestones, wall time, rounds)                                             |

When a condition is met and its key is in `go.halt_on`:

1. Stop starting new work. Do not merge, and do not push anything the halt is about.
2. Log a decision with `source: policy`, `risk: high`, and the key in `rationale`.
3. Write `summary.md` (see `summary-template.md`) when the skill owns the run.
4. End with `status: halted` (exit 20), or `awaiting-human` with a blocking `needs_input` when a single answer would unblock the task.

A condition whose key is not in `go.halt_on` becomes a B-Scope item: deferred and logged, never applied.

## Risk

Every decision carries a risk level. It feeds `max_risk` in `run.json` and the result block, and `esp-recap --risks`.

| Risk     | Use when                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| `low`    | Local, easily reverted, covered by tests (A-Fix items, Rejects with a clear reason)                                 |
| `medium` | A judgment call a reviewer may disagree with, or a change with weak test coverage (B-Decide)                        |
| `high`   | Touches security, data, public APIs, or merge and deploy behavior; every Halt and every deferral of a critical item |

## Logging

Log a decision when it is made, not at the end of the task. Every B-Decide, B-Scope, Reject and Halt is logged. A-Fix items are logged when a review or comment triggered them, so the PR body can show how each comment was resolved.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" decision --run-dir <path> --json '{
  "phase": "fix-review",
  "source": "agent",
  "risk": "medium",
  "decision": "Kept getUser() and added a deprecation note",
  "rationale": "B-Decide: renaming breaks 3 callers outside this task",
  "alternatives": ["Rename to fetchUser()"],
  "files": ["src/user.ts"],
  "refs": ["https://github.com/o/r/pull/12#discussion_r1"],
  "x-esp-class": "B-Decide"
}'
```

- `source`: `agent` for choices the model made, `policy` for rules applied from config (stop conditions, deferrals), `operator` for answers and messages.
- `x-esp-class`: the class from this policy (`A-Fix`, `B-Decide`, `B-Scope`, `Reject`, `Halt`).
- `rationale` starts with the class, then the reason.
- Without `--run-dir`, report the same information in the skill output instead.

## Deferred Items

B-Scope items, and items outside the task, are deferred per `fix-review.deferred_items`:

- `follow-up` (default): return the item in `discovered_items` of the result block, reply on the PR thread with the reason, and resolve it.
- `block`: leave the thread open, end with `awaiting-human`, and do not merge.

Every deferred item is a `discovered_items` entry with a `type` (`bug`, `debt`, `security`, `docs`, `test`, `follow-up`, `other`), a `title`, and `evidence`.
