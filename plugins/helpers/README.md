# Helpers

## Overview

A collection of simple, highly reusable utility skills for everyday tasks. These skills provide quick answers and clarification without making changes to your codebase.

- `/helpers:qna` - Get clear, concise answers to questions
- `/helpers:rubberduck` - Clarify ideas, plans, bugs, or concepts through discussion

## Skills

| Skill                 | Description                                         |
| --------------------- | --------------------------------------------------- |
| `/helpers:qna`        | Answer user questions with clear, concise responses |
| `/helpers:rubberduck` | Rubber duck debugging and idea clarification        |

## Complete Examples

### /helpers:qna

**Description:** Get a clear and concise answer to any question without any code changes or side effects.

**Examples:**

```bash
# Ask a technical question
/helpers:qna What is the difference between let and const in JavaScript?

# Ask for clarification
/helpers:qna How does OAuth 2.0 work?

# Ask for best practices
/helpers:qna What are the best practices for error handling in Node.js?
```

### /helpers:rubberduck

**Description:** Rubber duck debugging. Discuss and clarify an idea, plan, bug, or concept with AI assistance.

**Arguments:**

- `<context>` - The idea, plan, code snippet, or issue to discuss

**Examples:**

```bash
# Clarify a plan
/helpers:rubberduck I'm planning to refactor the authentication module. The idea is to extract the token validation logic into a separate middleware.

# Debug an issue
/helpers:rubberduck My component is not re-rendering when the prop changes. The useEffect hook should be triggered but it's not.

# Discuss a design decision
/helpers:rubberduck Should we use Redux or Context API for state management in this project?
```
