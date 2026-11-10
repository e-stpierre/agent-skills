# Feature Plan Reference

## Plan Sections

A feature plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Requirements`: functional and non-functional requirements (performance, security, UX)
- `## Architecture`: high-level design, the existing patterns it follows, integration points, data models and API contracts, and the key technical decisions
- `## Testing Strategy`: the unit, integration and end-to-end coverage the milestones add

Put feature-level validation in the acceptance criteria of the last milestone that completes it.

## Requirements Questions

Settle these from the context and the exploration; when one stays open, follow Asking and Deciding in the skill:

- The feature title and overview
- Functional requirements (what it should do)
- Non-functional requirements (performance, security, etc.)
- User experience expectations
- Technical constraints
- Integration points with existing systems

## Architecture Considerations

- Follow the existing patterns of the codebase and reuse its components
- Define data models and API contracts at the integration points
- Design for the stated requirements, with extensibility only where they call for it

## Milestone Design

- Each milestone delivers visible progress and is testable on its own
- Order by dependency (foundational first)
- Typically 2-5 milestones per feature
- Write tasks as specific, actionable steps with the file paths they change, and put the tests beside the implementation they cover

Common milestone patterns:

1. Core infrastructure and data models
2. Basic functionality (happy path)
3. Edge cases and error handling
4. Polish and optimization
5. Documentation and cleanup
