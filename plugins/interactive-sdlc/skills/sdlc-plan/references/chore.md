# Chore Plan Reference

## Planning Approach

Chore plans focus on maintenance tasks with clear scope boundaries. Understanding what's included and excluded prevents scope creep during implementation.

## Key Sections

A chore plan should include:

1. **Description**: Brief explanation of what needs to be done and why
2. **Scope**: What is included and explicitly out of scope
3. **Tasks**: Specific tasks required to complete the chore
4. **Validation Criteria**: How to verify the chore is complete

## Requirements Gathering

If chore details cannot be inferred from context, ask the user about:

- What is the chore title?
- What needs to be done?
- What is in scope and out of scope?
- Any specific files or areas to focus on?

## Scope Definition

Clear scope prevents scope creep:

- **In Scope**: Explicitly list what will be done
- **Out of Scope**: Explicitly list what will NOT be done
- Be specific about boundaries
- Note any related work that is intentionally deferred

## Common Chore Types

**Dependency Updates:**

- Update package versions
- Fix breaking changes
- Update lock files
- Verify compatibility

**Refactoring:**

- Improve code organization
- Apply consistent patterns
- Remove duplication
- Improve naming

**Cleanup:**

- Remove dead code
- Delete unused files
- Clean up imports
- Remove deprecated features

**Configuration:**

- Update build configs
- Modify CI/CD settings
- Update environment settings
- Adjust tooling

## Task Organization

Chore tasks should be:

- Ordered logically (dependencies first)
- Specific and actionable
- Focused on the defined scope
- Verifiable when complete

## Template

```markdown
# Chore: {{chore_title}}

<!--
Instructions:
- Replace {{chore_title}} with a concise title for the chore
- Use title case (e.g., "Update All Dependencies")
-->

## Description

{{description}}

<!--
Instructions:
- Replace {{description}} with a brief explanation of what needs to be done and why
- Keep it to 1-3 sentences
-->

## Scope

{{scope}}

<!--
Instructions:
- Replace {{scope}} with what is included and what is explicitly out of scope
- Use bullet points for clarity
- Example:
  In scope:
  - Update npm dependencies
  - Fix breaking changes

  Out of scope:
  - Updating Python dependencies
  - Refactoring unrelated code
-->

## Tasks

{{tasks}}

<!--
Instructions:
- Replace {{tasks}} with a numbered list of specific tasks required to complete this chore
- Tasks should be in execution order
- Each task should be actionable and clear
-->

## Validation Criteria

{{validation_criteria}}

<!--
Instructions:
- Replace {{validation_criteria}} with specific criteria to verify the chore is complete
- Use bullet points or checklist format
- Make criteria objective and measurable
-->
```
