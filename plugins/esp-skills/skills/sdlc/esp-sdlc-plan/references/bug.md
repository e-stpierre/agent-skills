# Bug Fix Plan Reference

## Planning Approach

Bug fix plans focus on thorough root cause analysis and prevention of regression. Understanding the cause is critical to implementing an effective fix.

## Key Sections

A bug fix plan should include:

1. **Description**: Clear explanation of the bug and its impact
2. **Reproduction Steps**: Step-by-step instructions to reproduce the bug
3. **Root Cause Analysis**: Technical explanation of why the bug occurs
4. **Fix Strategy**: High-level approach to fixing the bug
5. **Tasks**: Specific implementation tasks
6. **Validation**: Steps to verify the fix works
7. **Testing**: Test cases to prevent regression

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

Bug fixes typically have 2-3 milestones:

1. **Investigation & Setup**: Reproduce bug, identify root cause, prepare environment
2. **Implementation**: Apply fix, handle edge cases
3. **Validation & Testing**: Verify fix, add regression tests

## Template

```markdown
# Bug Fix: {{bug_title}}

<!--
Instructions:
- Replace {{bug_title}} with a concise title for the bug
- Use title case (e.g., "Login Timeout on Safari OAuth Redirect")
-->

## Description

{{description}}

<!--
Instructions:
- Replace {{description}} with a clear explanation of the bug and its impact
- Include what is broken, who is affected, and the severity
-->

## Reproduction Steps

{{reproduction_steps}}

<!--
Instructions:
- Replace {{reproduction_steps}} with numbered step-by-step instructions to reproduce the bug
- Be specific enough that anyone can follow the steps
- Example:
  1. Navigate to /login
  2. Click "Login with OAuth"
  3. Complete OAuth flow on provider site
  4. Observe redirect to blank page instead of dashboard
-->

## Root Cause Analysis

{{root_cause}}

<!--
Instructions:
- Replace {{root_cause}} with technical explanation of why the bug occurs
- Include code references, execution flow, and specific conditions that trigger the bug
- Be thorough - understanding the cause is critical to the fix
-->

## Fix Strategy

{{fix_strategy}}

<!--
Instructions:
- Replace {{fix_strategy}} with high-level approach to fixing the bug
- Explain what changes need to be made and why
- Address the root cause, not just symptoms
-->

## Tasks

{{tasks}}

<!--
Instructions:
- Replace {{tasks}} with numbered list of specific tasks to implement the fix
- Include code changes, configuration updates, etc.
- Order tasks logically
-->

## Validation

{{validation}}

<!--
Instructions:
- Replace {{validation}} with steps to verify the bug is fixed and won't regress
- Include manual testing steps and automated checks
-->

## Testing

{{testing}}

<!--
Instructions:
- Replace {{testing}} with test cases to add or update to prevent regression
- Specify unit tests, integration tests, or e2e tests as appropriate
-->
```
