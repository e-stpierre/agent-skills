# Technical Debt Analysis Reference

## Analysis Criteria

Look for technical debt indicators:

**Architecture:**

- Circular dependencies
- Overly complex module structures
- Missing abstraction layers
- Tight coupling between components

**Code Quality:**

- Code duplication
- Complex functions (high cyclomatic complexity)
- Long methods/classes
- Poor naming conventions
- Magic numbers/strings

**Patterns:**

- Outdated patterns (callbacks vs async/await)
- Inconsistent patterns across codebase
- Anti-patterns
- Framework misuse

**Performance:**

- Obvious performance bottlenecks
- N+1 query patterns
- Unnecessary re-renders
- Missing caching opportunities

## Core Principles

- Focus on REAL debt - not everything needs refactoring
- Working code has value - perfect is the enemy of good
- Prioritize by impact - frequently touched code > rarely touched
- Avoid over-engineering and premature abstractions
- Understand why patterns exist before flagging them - some "debt" is intentional
- Base recommendations on concrete requirements, not hypothetical future needs

## Severity Guidelines

- **Critical**: Architectural issues blocking development or causing systemic failures
- **High**: Significant debt affecting multiple modules or team productivity
- **Medium**: Localized issues with moderate impact on maintainability
- **Low**: Minor improvements, cleanup opportunities

## Effort Estimation

**Low Effort:**

- Simple refactoring
- Renaming for clarity
- Extracting small functions
- Adding types/documentation

**Medium Effort:**

- Extracting modules/classes
- Refactoring patterns
- Adding caching
- Query optimization

**High Effort:**

- Architectural changes
- Major refactoring
- Database schema changes
- API redesign

## Report Template

```markdown
# Tech Debt

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what was analyzed
- Example: "Entire codebase" or "Data access layer"
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

### DEBT-{{debt_number}}: {{debt_title}}

<!--
Instructions:
- Replace {{debt_number}} with sequential number (001, 002, etc.)
- Replace {{debt_title}} with concise debt title
- Use this format for each debt item found
-->

**Category:** {{category}}

<!--
Instructions:
- Replace {{category}} with: Architecture, Code Quality, or Performance
-->

**Location:** {{location}}

<!--
Instructions:
- Replace {{location}} with files or modules affected
- Example: "src/api/*, src/db/*" or "Authentication module"
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with current problematic pattern
- Explain what is wrong with the current approach
-->

**Improvement:** {{improvement}}

<!--
Instructions:
- Replace {{improvement}} with suggested improvement
- Be specific about what should change
-->

**Effort:** {{effort}}

<!--
Instructions:
- Replace {{effort}} with Low / Medium / High
- Consider scope and complexity of the change
-->

---

## High

<!--
Instructions:
- Use same format as Critical section
- Include all high severity debt items
-->

## Medium

<!--
Instructions:
- Use same format as Critical section
- Include all medium severity debt items
-->

## Low

<!--
Instructions:
- Use same format as Critical section
- Include all low severity debt items
-->
```
