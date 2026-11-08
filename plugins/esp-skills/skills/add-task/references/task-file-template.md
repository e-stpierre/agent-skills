<!--
TASK FILE TEMPLATE

This template defines the structure for task tracking documents created by the add-task skill.

REQUIRED SECTIONS (in order):
1. Title (# Tasks)
2. How to Use This File
3. Progress Tracking
4. Tasks List

TASK ENTRY STRUCTURE:
Each task consists of two parts:
1. A checkbox line in the Progress Tracking section
2. A detailed section in the Tasks List

ID PREFIX CONVENTIONS:
- IMP-XXX for general improvements (default)
- SEC-XXX for security-related tasks
- DEBT-XXX for technical debt
- TEST-XXX for testing tasks
- DOC-XXX for documentation tasks
-->

# Tasks

<!--
Instructions:
- This is the document title
- Do not add description text directly after the title
-->

## How to Use This File

1. **Adding Tasks**: Add a checkbox to the Progress Tracking section (`- [ ] IMP-XXX: Short title`) and a corresponding details section with problem description, files to investigate, and acceptance criteria.
2. **Working on Tasks**: Mark the item as in-progress by keeping `[ ]` and update the Status in the details section to "In Progress".
3. **Completing Tasks**: Change `[ ]` to `[x]` and update the Status to "Completed".

<!--
Instructions:
- This section is static and should be copied as-is when creating new task files
- Do not modify the usage instructions
-->

## Progress Tracking

- [ ] IMP-001: Add retry logic to payment webhook handler
- [ ] SEC-002: Sanitize user input in search endpoint

<!--
Instructions:
- Each task gets a single checkbox line in this section
- Format: `- [ ] ID: Short title`
- New tasks are appended at the end of the list
- Mark completed tasks with `[x]`
-->

## Tasks List

List the details of every task request, 100 lines maximum per item.

---

### IMP-001: Add retry logic to payment webhook handler

**Status**: Pending

**Problem**: Payment webhook events from Stripe are occasionally dropped when the server is under load. There is no retry mechanism, causing missed payment confirmations.

**Files to Investigate**:

- `src/webhooks/stripe-handler.ts` - Current webhook processing logic
- `src/services/payment-service.ts` - Payment confirmation flow

**Expected Behavior / Goal**: Failed webhook deliveries should be retried with exponential backoff up to 3 attempts before being logged as failed.

**Acceptance Criteria**:

- [ ] Webhook handler retries failed processing up to 3 times
- [ ] Retry uses exponential backoff (1s, 4s, 16s)
- [ ] Failed attempts after all retries are logged with full context

---

### SEC-002: Sanitize user input in search endpoint

**Status**: Pending

**Problem**: The `/api/search` endpoint passes user input directly to the database query without sanitization, creating a potential injection vector.

**Files to Investigate**:

- `src/routes/search.ts` - Search endpoint handler
- `src/db/queries.ts` - Database query builder

**Expected Behavior / Goal**: All user input to the search endpoint should be sanitized before reaching the database layer.

**Acceptance Criteria**:

- [ ] User input is sanitized before query construction
- [ ] Parameterized queries are used instead of string interpolation
- [ ] Existing search functionality is preserved

<!--
Instructions:
- Each task entry starts with a horizontal rule (---)
- Format: ### ID: Short descriptive title
- Required fields per entry:
  - **Status**: Pending | In Progress | Completed
  - **Problem**: Clear description of the issue or opportunity
  - **Files to Investigate**: Bullet list of relevant file paths with brief notes
  - **Expected Behavior / Goal**: What the task should achieve
  - **Acceptance Criteria**: Checkbox list of measurable completion criteria
- Keep each entry under 100 lines
- Entries are appended at the end of this section
-->
