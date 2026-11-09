# Chore Plan Reference

## Planning Approach

Chore plans focus on maintenance tasks with clear scope boundaries. Understanding what's included and excluded prevents scope creep during implementation.

## Plan Sections

A chore plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Scope`: what is included, in specific terms (what is excluded goes in `## Out of Scope`)
- `## Current State`: the versions, files or patterns the chore starts from, when it helps the builder

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
