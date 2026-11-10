# Chore Plan Reference

## Plan Sections

A chore plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Scope`: what is included, in specific terms
- `## Current State`: the versions, files or patterns the chore starts from, when it helps the builder

Scope is the chore's main risk: list what is excluded in `## Out of Scope`, including related work that is intentionally deferred, so the build cannot creep.

## Requirements Questions

Settle these from the context and the exploration; when one stays open, follow Asking and Deciding in the skill:

- The chore title and what needs to be done
- What is in scope and out of scope
- The files or areas to focus on

## Common Chore Types

- **Dependency updates**: package versions, the breaking changes they bring, lock files, compatibility checks
- **Refactoring**: code organization, consistent patterns, duplication, naming
- **Cleanup**: dead code, unused files, imports, deprecated features
- **Configuration**: build configs, CI/CD settings, environment settings, tooling

## Task Organization

Order tasks by dependency, and keep each one inside the defined scope and verifiable when complete.
