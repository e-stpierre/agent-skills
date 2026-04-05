---
name: qna
description: Answer questions clearly and concisely without modifying the codebase
argument-hint: "<question>"
---

# Q&A

## Overview

Answer any question with a clear and concise response. This is a read-only skill -- it gathers context when needed but never modifies the codebase, creates files, or runs commands with side effects.

## Arguments

### Definitions

- **`<question>`** (required): The question to answer

### Values

Arguments: $ARGUMENTS

## Core Principles

- Provide direct, clear answers without unnecessary preamble
- Do not modify the codebase, create files, or run commands with side effects
- Read-only operations (Read, Grep, Glob) are acceptable to gather context for answering
- Use examples when they help clarify the answer

## Instructions

1. Parse the question from the arguments
2. If code context is needed, gather it using read-only operations (Read, Grep, Glob)
3. Provide a clear, concise answer based on the question and any gathered context

## Output Guidance

Direct text answer. No JSON, no structured output. Keep it brief and to the point.
