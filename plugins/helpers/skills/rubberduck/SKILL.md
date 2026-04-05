---
name: rubberduck
description: Rubber duck debugging and idea clarification through discussion
argument-hint: <context>
disable-model-invocation: false
---

# Rubber Duck

## Overview

Rubber duck debugging and clarification tool. Discuss ideas, plans, bugs, or concepts to gain clarity. Claude acts as a sounding board, asking clarifying questions and suggesting improvements.

## Arguments

### Definitions

- **`<context>`** (required): The idea, plan, code snippet, bug description, or concept to discuss

### Values

Arguments: $ARGUMENTS

## Core Principles

- Help clarify thinking through discussion
- Ask clarifying questions to deepen understanding
- Suggest improvements and identify potential issues
- For code-related issues, explore codebase context when needed
- Highlight blockers and risks

## Instructions

1. Read the context provided
2. If the request involves code in the codebase, use explore agents to gather context
3. Based on the situation, do one or more of:
   - Ask clarifying questions to deepen understanding
   - Suggest new ideas and possible improvements
   - Highlight issues, edge cases, or potential blockers
4. Provide constructive feedback to help refine the idea
