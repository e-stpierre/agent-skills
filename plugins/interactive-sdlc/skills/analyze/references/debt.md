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

| Category     | Issues                 | Total Effort            |
| ------------ | ---------------------- | ----------------------- |
| Architecture | {{architecture_count}} | {{architecture_effort}} |
| Code Quality | {{code_quality_count}} | {{code_quality_effort}} |
| Performance  | {{performance_count}}  | {{performance_effort}}  |

<!--
Instructions:
- Replace {{architecture_count}}, {{code_quality_count}}, {{performance_count}} with issue counts
- Replace {{architecture_effort}}, {{code_quality_effort}}, {{performance_effort}} with Low/Med/High
- Total effort is aggregate of individual item efforts
-->

## Architecture

### DEBT-{{debt_number}}: {{debt_title}}

<!--
Instructions:
- Replace {{debt_number}} with sequential number (001, 002, etc.)
- Replace {{debt_title}} with concise debt title
- Use this format for each architecture debt item found
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

**Benefit:** {{benefit}}

<!--
Instructions:
- Replace {{benefit}} with why this matters
- Explain the value of making this change
-->

**Effort:** {{effort}}

<!--
Instructions:
- Replace {{effort}} with Low / Medium / High
- Consider scope and complexity of the change
-->

---

## Code Quality

<!--
Instructions:
- Use same format as Architecture section
- Include all code quality debt items
-->

## Performance

<!--
Instructions:
- Use same format as Architecture section
- Include all performance debt items
-->
```
