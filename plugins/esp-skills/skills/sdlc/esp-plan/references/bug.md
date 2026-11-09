# Bug Fix Plan Reference

## Planning Approach

Bug fix plans focus on thorough root cause analysis and prevention of regression. Understanding the cause is critical to implementing an effective fix.

## Plan Sections

A bug fix plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Reproduction`: observed behavior, expected behavior, and the steps to reproduce
- `## Root Cause`: the technical explanation of why the bug occurs, with file and line references
- `## Fix Strategy`: the approach, and why it addresses the cause rather than the symptom

Investigate and find the root cause while planning, not in a milestone: every milestone is a commit, so it must change code.

## Requirements Gathering

If bug details cannot be inferred from context, ask the user about:

- What is the bug title/summary?
- What is the observed behavior?
- What is the expected behavior?
- What are the reproduction steps?
- What is the impact of this bug?

## Investigation Focus

When analyzing a bug:

- Trace the execution path that leads to the bug
- Identify the specific conditions that trigger it
- Look for related code paths that may have similar issues
- Check if there are existing tests that should have caught this
- Understand the impact scope (which users/features are affected)

## Root Cause Categories

Common root causes to investigate:

- **Logic Errors**: Incorrect conditions, off-by-one errors, wrong operators
- **State Management**: Race conditions, stale data, incorrect state transitions
- **Error Handling**: Unhandled exceptions, silent failures, missing edge cases
- **Integration Issues**: API contract violations, data format mismatches
- **Configuration**: Environment-specific issues, missing settings
- **Resource Management**: Memory leaks, connection exhaustion, deadlocks

## Fix Strategy Guidelines

- Address the root cause, not just symptoms
- Consider defensive measures to prevent similar bugs
- Avoid fixes that introduce new complexity
- Prefer targeted changes over broad refactoring
- Include test coverage for the specific failure case

## Milestone Structure

Bug fixes typically have 1-2 milestones:

1. **Fix**: add a failing regression test, then the fix that makes it pass
2. **Hardening** (optional): related code paths with the same flaw, defensive checks, edge cases
