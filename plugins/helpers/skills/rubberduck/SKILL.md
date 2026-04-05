---
name: rubberduck
description: Clarify ideas through discussion, questions, and suggestions based on conversation context
argument-hint: "<context>"
---

# Rubber Duck

## Overview

Rubber duck debugging and idea clarification skill. Based on the conversation context and the provided argument, help the user think through a plan, bug, architecture decision, or any other concept. This skill focuses on helping the user think, not on doing work for them.

## Arguments

### Definitions

- **`<context>`** (required): Description of what the user wants to clarify (plan, bug, architecture decision, etc.)

### Values

Arguments: $ARGUMENTS

## Core Principles

- Use the conversation context and provided argument as primary input
- If code-related, use explore agents to navigate the codebase for relevant context
- Focus on helping the user think through the problem, not solving it for them
- Highlight potential blockers, edge cases, or risks

## Instructions

1. Analyze the context and conversation history to understand what the user wants to clarify
2. If the topic is code-related, launch explore agents to gather relevant codebase context
3. Based on the situation, do one or more of:
   - Ask clarifying questions to deepen understanding
   - Suggest new ideas and possible improvements
   - Highlight issues, edge cases, or potential blockers
4. Keep the discussion conversational and focused on the user's thinking process

## Output Guidance

Conversational text with sections as needed. Use headings for questions, suggestions, and concerns when multiple areas are covered.
