# Bug Analysis Reference

## Analysis Criteria

Focus on finding REAL bugs, not theoretical concerns:

**Logic Errors:**

- Incorrect conditions, off-by-one errors
- Inverted boolean logic, missing negations
- Incorrect loop bounds or termination conditions

**Runtime Errors:**

- Null/undefined access without guards
- Type mismatches and coercion issues
- Uninitialized variables, use before assignment
- Array index out of bounds

**Error Handling:**

- Unhandled exceptions, missing catch blocks
- Silent failures that swallow errors
- Missing error cases in switch/if chains
- Promises without rejection handling

**Race Conditions:**

- Async timing issues, state corruption
- Shared state modifications without synchronization
- Deadlocks and livelocks
- Check-then-act patterns without atomicity

**Resource Leaks:**

- Unclosed file handles, streams, connections
- Memory leaks from retained references
- Connection pool exhaustion
- Event listener accumulation

**Edge Cases:**

- Boundary conditions (empty, max, min values)
- Empty inputs, null collections
- Overflow/underflow scenarios
- Unicode and encoding edge cases

## Severity Guidelines

- **Critical**: Will cause crashes, data loss, or security issues in normal operation
- **High**: Significant functional bugs affecting users under common conditions
- **Medium**: Edge case bugs, minor functional issues, rare conditions
- **Low**: Potential issues, defensive improvements, unlikely scenarios

## Report Template

```markdown
# Bug Report

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what was analyzed
- Example: "Entire codebase" or "src/auth/ and src/api/"
-->

## Summary

- Critical: {{critical_count}} issues
- High: {{high_count}} issues
- Medium: {{medium_count}} issues
- Low: {{low_count}} issues

<!--
Instructions:
- Replace {{critical_count}}, {{high_count}}, {{medium_count}}, {{low_count}} with actual counts
- If count is 0, you can say "0 issues" or omit the category
-->

## Critical

### BUG-{{bug_number}}: {{bug_title}}

<!--
Instructions:
- Replace {{bug_number}} with sequential number (001, 002, etc.)
- Replace {{bug_title}} with concise bug title
- Use this format for each critical bug found
-->

**Location:** {{file_location}}

<!--
Instructions:
- Replace {{file_location}} with the file(s) where the bug is located
- Format: file:line (e.g., "src/auth/login.ts:45")
- If multiple locations, list them all
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with clear description of the bug
- Explain what is wrong and why it's a problem
-->

**Impact:** {{impact}}

<!--
Instructions:
- Replace {{impact}} with what happens because of this bug
- Focus on user impact and consequences
-->

**Fix:** {{fix_suggestion}}

<!--
Instructions:
- Replace {{fix_suggestion}} with suggested fix approach
- Be specific and actionable
-->

---

## High

<!--
Instructions:
- Use same format as Critical section
- Include all high severity bugs
-->

## Medium

<!--
Instructions:
- Use same format as Critical section
- Include all medium severity bugs
-->

## Low

<!--
Instructions:
- Use same format as Critical section
- Include all low severity bugs
-->
```
