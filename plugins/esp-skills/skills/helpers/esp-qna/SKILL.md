---
name: esp-qna
description: Answer questions clearly and concisely without modifying the codebase
argument-hint: "<question>"
---

# Q&A

## Overview

Answer a question with a clear, concise response. The skill is read-only: it gathers context when the answer needs it and leaves the codebase, the files and the environment exactly as they were.

## Arguments

### Definitions

- **`<question>`** (required): The question to answer: all the free text.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Read-only: gather context with read-only tools (Read, Grep, Glob) and read-only commands; every edit, new file, and command with side effects is out of scope, even when the answer suggests one
- Lead with the answer, then the support; add an example when it clarifies

## Instructions

1. Read the question from the free text.
2. When the answer depends on the code, gather context read-only until every claim in the answer is backed by a file or line you read.
3. Answer the question.

## Output Guidance

A direct text answer, as brief as the question allows.
