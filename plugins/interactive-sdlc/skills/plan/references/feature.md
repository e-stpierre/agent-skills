# Feature Plan Reference

## Planning Approach

Feature plans focus on comprehensive design with incremental delivery. Each milestone should be independently valuable and testable. Architecture decisions should align with existing codebase patterns.

## Key Sections

A feature plan should include:

1. **Overview**: What the feature does and why it's valuable
2. **Requirements**: Functional and non-functional requirements
3. **Architecture**: High-level design and patterns to use
4. **Milestones**: Logical breakdown with tasks
5. **Testing Strategy**: How the feature will be tested
6. **Validation Criteria**: How to verify the feature is complete

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
- Keep milestones small enough to complete in 1-3 sessions
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

## Template

```markdown
# Feature: {{feature_title}}

<!--
Instructions:
- Replace {{feature_title}} with a concise title for the feature
- Use title case (e.g., "User Authentication with OAuth")
-->

## Overview

{{overview}}

<!--
Instructions:
- Replace {{overview}} with what this feature does and why it's valuable
- Explain the user benefit and business value
- Keep it to 2-4 sentences
-->

## Requirements

{{requirements}}

<!--
Instructions:
- Replace {{requirements}} with functional and non-functional requirements
- Use bullet points or subsections
- Include performance, security, and UX requirements as applicable
- Example:
  Functional:
  - Users can log in with Google OAuth
  - Users can log in with GitHub OAuth

  Non-functional:
  - OAuth flow must complete within 5 seconds
  - Must support 10,000 concurrent OAuth sessions
-->

## Architecture

{{architecture}}

<!--
Instructions:
- Replace {{architecture}} with high-level design decisions and patterns to use
- Explain component structure, data flow, and integration points
- Reference existing patterns in the codebase
-->

## Milestones

### Milestone {{milestone_number}}: {{milestone_title}}

<!--
Instructions:
- Replace {{milestone_number}} with milestone number (1, 2, 3, etc.)
- Replace {{milestone_title}} with what this milestone achieves
- Each milestone should be independently valuable
-->

{{milestone_description}}

<!--
Instructions:
- Replace {{milestone_description}} with a brief description of what this milestone accomplishes
-->

#### Task {{milestone_number}}.{{task_number}}: {{task_title}}

<!--
Instructions:
- Replace {{task_number}} with task number within the milestone
- Replace {{task_title}} with a clear, actionable task title
- Include multiple tasks per milestone as needed
-->

{{task_description}}

<!--
Instructions:
- Replace {{task_description}} with specific task description
- Make it actionable and clear
- Include acceptance criteria if needed
-->

<!--
Instructions:
- Add additional milestones following the same structure
- Each milestone should build on previous ones
- Typical features have 2-5 milestones
-->

## Testing Strategy

{{testing_strategy}}

<!--
Instructions:
- Replace {{testing_strategy}} with how this feature will be tested
- Include unit tests, integration tests, e2e tests as appropriate
- Specify test coverage expectations
-->

## Validation Criteria

{{validation_criteria}}

<!--
Instructions:
- Replace {{validation_criteria}} with specific criteria to verify the feature is complete and working
- Use checklist format
- Make criteria objective and measurable
-->
```
