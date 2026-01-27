# Documentation Analysis Reference

## Analysis Criteria

Check documentation for:

- **Outdated information**: Does not match current code
- **Incorrect content**: Factually wrong statements
- **Missing documentation**: Undocumented APIs, features
- **Broken references**: Dead links, invalid paths
- **Inconsistencies**: Contradictory information
- **Incomplete examples**: Non-working code samples

## Core Principles

- Only report REAL issues - good documentation is a success
- Verify claims against code before marking as incorrect
- Provide actionable fixes with correct information
- Consider documentation might be ahead of code (planned features)
- Different documentation types have different standards (user guides vs API references vs internal docs)

## Verification Steps

- Compare API documentation with actual implementations
- Check if documented features exist
- Verify code examples compile/run
- Ensure types match documented signatures

## Severity Guidelines

**Critical (Wrong/Misleading):**

- Documents non-existent features
- Wrong API signatures
- Incorrect behavior descriptions
- Security-related misinformation

**High (Outdated/Incomplete):**

- Features added but not documented
- Deprecated features still documented
- Missing important sections
- Outdated examples

**Medium (Improvements):**

- Typos and grammar issues
- Unclear explanations
- Missing examples
- Better organization suggestions

## Report Template

```markdown
# Documentation Issues

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what documentation was analyzed
- Example: "All markdown files in docs/" or "API documentation"
-->

## Summary

- Critical (Wrong/Misleading): {{critical_count}} issues
- High (Outdated/Incomplete): {{high_count}} issues
- Medium (Improvements): {{medium_count}} issues

<!--
Instructions:
- Replace {{critical_count}}, {{high_count}}, {{medium_count}} with actual counts
- If count is 0, you can say "0 issues" or omit the category
-->

## Critical Issues (Completely Wrong/Misleading)

### DOC-{{issue_number}}: {{issue_title}}

<!--
Instructions:
- Replace {{issue_number}} with sequential number (001, 002, etc.)
- Replace {{issue_title}} with concise issue title
- Use this format for each critical documentation issue found
-->

**Files:** {{affected_files}}

<!--
Instructions:
- Replace {{affected_files}} with list of affected documentation files
- Example: "docs/api.md, README.md"
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with what is wrong or misleading
- Be specific about the incorrect information
-->

**Code Reference:** {{code_location}}

<!--
Instructions:
- Replace {{code_location}} with related code location if applicable
- Format: file:line (e.g., "src/api/routes.ts:120")
- Use "N/A" if not applicable
-->

**Fix:** {{fix_suggestion}}

<!--
Instructions:
- Replace {{fix_suggestion}} with how to correct the documentation
- Include the correct information
-->

---

## High Issues (Outdated/Incomplete)

<!--
Instructions:
- Use same format as Critical Issues section
- Include all high severity documentation issues
-->

## Medium Issues (Improvements)

<!--
Instructions:
- Use same format as Critical Issues section
- Include all medium documentation improvements
-->
```
