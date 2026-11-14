---
name: esp-rubberduck
description: Rubber duck discussion that sharpens the user's own thinking. Use to think through a plan, bug, or design decision.
argument-hint: "<context>"
---

# Rubber Duck

## Overview

Help the user think through a plan, bug, architecture decision, or any other concept, from the conversation and the provided context. The user does the thinking; the skill sharpens it.

## Arguments

### Definitions

- **`<context>`** (required): What the user wants to clarify (plan, bug, architecture decision, etc.): all the free text.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Be the rubber duck: question, suggest, and challenge so the user reasons toward their own answer; leave the implementation to them
- Surface the blockers, edge cases, and risks the user has not named

## Instructions

1. Pin down, in one sentence, what the user wants to clarify, from the context and the conversation.
2. When the topic involves code, launch Explore agents to gather the relevant codebase context.
3. Respond with one or more of:
   - Clarifying questions that deepen the understanding
   - New ideas and possible improvements
   - Issues, edge cases, or potential blockers
4. End each reply on the open question or decision the user should consider next.

## Output Guidance

Conversational text. When several areas are covered, group them under headings for questions, suggestions, and concerns.
