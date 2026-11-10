# Bug Fix Plan Reference

## Plan Sections

A bug fix plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Reproduction`: observed behavior, expected behavior, and the steps to reproduce
- `## Root Cause`: the technical explanation of why the bug occurs, with file and line references
- `## Fix Strategy`: the approach, and why it addresses the cause rather than the symptom

Find the root cause while planning, not in a milestone: every milestone is a commit, so it must change code.

## Requirements Questions

Settle these from the context and the exploration; when one stays open, follow Asking and Deciding in the skill:

- The bug summary
- The observed and the expected behavior
- The reproduction steps
- The impact (which users or features are affected)

## Investigation Focus

- Trace the execution path that leads to the bug and the conditions that trigger it
- Look for related code paths with the same flaw
- Check whether existing tests should have caught it

Common root causes:

- **Logic errors**: incorrect conditions, off-by-one errors, wrong operators
- **State management**: race conditions, stale data, incorrect state transitions
- **Error handling**: unhandled exceptions, silent failures, missing edge cases
- **Integration issues**: API contract violations, data format mismatches
- **Configuration**: environment-specific issues, missing settings
- **Resource management**: memory leaks, connection exhaustion, deadlocks

## Fix Strategy Guidelines

- Fix the root cause with a targeted change; leave broad refactoring to a chore
- Keep the fix as simple as the cause allows, adding defensive measures only where similar bugs are likely
- Cover the specific failure case with a regression test

## Milestone Structure

Bug fixes typically have 1-2 milestones:

1. **Fix**: add a failing regression test, then the fix that makes it pass
2. **Hardening** (optional): related code paths with the same flaw, defensive checks, edge cases
