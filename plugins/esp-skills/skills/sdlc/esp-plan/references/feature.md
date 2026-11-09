# Feature Plan Reference

## Planning Approach

Feature plans focus on comprehensive design with incremental delivery. Each milestone should be independently valuable and testable. Architecture decisions should align with existing codebase patterns.

## Plan Sections

A feature plan follows [plan format 1](../../../../references/plan-format.md). Use these context sections between `## Overview` and `## Milestones`:

- `## Requirements`: functional and non-functional requirements (performance, security, UX)
- `## Architecture`: high-level design, the existing patterns it follows, integration points, data models and API contracts
- `## Testing Strategy`: unit, integration and end-to-end coverage the milestones add

Put feature-level validation in the acceptance criteria of the last milestone that completes it.

## Requirements Gathering

If requirements cannot be inferred from context, ask the user about:

- Feature title and overview
- Functional requirements (what it should do)
- Non-functional requirements (performance, security, etc.)
- User experience expectations
- Technical constraints
- Integration points with existing systems

## Architecture Considerations

When designing the feature:

- Study existing patterns in the codebase
- Identify integration points with existing code
- Define data models and API contracts
- Consider component reusability
- Plan for extensibility without over-engineering
- Document key technical decisions

## Milestone Design

Break features into logical milestones:

- Each milestone should deliver visible progress
- Milestones should be testable independently
- Order by dependency (foundational first)
- Keep each milestone one coherent, reviewable commit
- Typically 2-5 milestones per feature

**Common milestone patterns:**

1. Core infrastructure/data models
2. Basic functionality (happy path)
3. Edge cases and error handling
4. Polish and optimization
5. Documentation and cleanup

## Task Decomposition

Within each milestone:

- Tasks should be specific and actionable
- Include file paths where changes are needed
- Consider testing tasks alongside implementation
- Note any dependencies between tasks

## Testing Strategy

Plan testing at multiple levels:

- **Unit Tests**: Individual functions and components
- **Integration Tests**: Component interactions
- **E2E Tests**: Full user flows
- **Manual Testing**: Exploratory and edge cases
