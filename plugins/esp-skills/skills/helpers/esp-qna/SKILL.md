---
name: esp-qna
description: Read-only answer to a question. Use when the user asks about the code or a concept and wants no changes made.
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

- Read-only: gather context with read-only tools (Read, Grep, Glob) and read-only commands. Every edit, new file, and command with side effects is out of scope, even when the answer suggests one: describe the change in the answer instead
- Lead with the answer, then the support; add an example when it clarifies

## Instructions

1. When the answer depends on the code, gather context read-only until every claim in the answer is backed by a file or line you read.
2. Answer the question, leading with the answer.

## Output Guidance

A direct text answer, as brief as the question allows.
