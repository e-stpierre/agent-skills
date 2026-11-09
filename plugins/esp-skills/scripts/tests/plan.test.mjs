import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { completedFromState, diffPlans, parsePlan } from "../plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "plan.mjs");
const RUNS = join(HERE, "..", "runs.mjs");
const REFERENCE = join(HERE, "..", "..", "references", "plan-format.md");

/** The example plan at the end of references/plan-format.md. */
function referenceExample() {
  const text = readFileSync(REFERENCE, "utf8");
  const example = text.slice(text.indexOf("## Example"));
  const m = /```markdown\r?\n([\s\S]*?)\r?\n```\s*$/.exec(example);
  assert.ok(m, "plan-format.md has an example plan");
  return `${m[1]}\n`;
}

const EXAMPLE = referenceExample();

function cli(args, script = SCRIPT, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

const errorsOf = (text, opts) => parsePlan(text, opts).errors;

describe("parsePlan", () => {
  test("the reference example parses without errors", () => {
    const { plan, errors, warnings } = parsePlan(EXAMPLE);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.equal(plan.title, "Add OAuth login");
    assert.equal(plan.type, "feature");
    assert.equal(plan.version, 1);
    assert.equal(plan.created, "2026-11-08");
    assert.deepEqual(plan.context.map((c) => c.title), ["Architecture"]);
    assert.deepEqual(plan.open_questions, []);
    assert.deepEqual(plan.out_of_scope, ["Other OAuth providers"]);
    assert.equal(plan.milestones.length, 2);
    assert.deepEqual(plan.milestones[1], {
      id: "M2",
      title: "Add the login route",
      goal: "Users sign in with Google from the login page",
      complexity: "low",
      depends: ["M1"],
      files: ["src/routes/login.ts", "src/views/login.html"],
      tasks: ["Add `/auth/google` and `/auth/google/callback`", 'Add the "Sign in with Google" button'],
      acceptance: ["A successful callback creates a session and redirects to `/`"],
      validation: ["pnpm test", "pnpm lint"]
    });
    assert.deepEqual(plan.milestones[0].depends, []);
  });

  test("ignores HTML comments and joins continuation lines", () => {
    const text = EXAMPLE.replace(
      "1. Add `src/auth/google.ts` with `authorizeUrl()` and `exchangeCode()`",
      "<!-- a comment -->\n1. Add `src/auth/google.ts`\n   with two functions"
    ).replace(
      "- **Goal**: The app can complete a Google OAuth flow and read the user profile",
      "- **Goal**: The app can complete a Google OAuth flow\n  and read the user profile"
    );
    const { plan, errors } = parsePlan(text);
    assert.deepEqual(errors, []);
    assert.equal(plan.milestones[0].tasks[0], "Add `src/auth/google.ts`\n   with two functions");
    assert.equal(plan.milestones[0].goal, "The app can complete a Google OAuth flow and read the user profile");
  });

  test("ignores headings inside code fences", () => {
    const text = EXAMPLE.replace(
      "2. Add unit tests with a mocked token endpoint",
      "2. Add unit tests:\n\n   ```text\n   ## Not a section\n   ### M9: not a milestone\n   ```"
    );
    const { plan, errors } = parsePlan(text);
    assert.deepEqual(errors, []);
    assert.equal(plan.milestones.length, 2);
  });

  test("accepts a byte order mark and CRLF line endings", () => {
    const text = String.fromCharCode(0xfeff) + EXAMPLE.replace(/\n/g, "\r\n");
    const { plan, errors } = parsePlan(text);
    assert.deepEqual(errors, []);
    assert.equal(plan.milestones.length, 2);
    assert.deepEqual(plan.milestones[1].validation, ["pnpm test", "pnpm lint"]);
  });

  test("warns on open questions", () => {
    const text = EXAMPLE.replace("## Open Questions\n\n- None", "## Open Questions\n\n- Which scopes?");
    const { plan, errors, warnings } = parsePlan(text);
    assert.deepEqual(errors, []);
    assert.deepEqual(plan.open_questions, ["Which scopes?"]);
    assert.match(warnings[0], /open question/);
  });

  const invalid = [
    ["missing frontmatter", (t) => t.replace(/^---[\s\S]*?---\n/, ""), /frontmatter: missing/],
    ["wrong plan_format", (t) => t.replace("plan_format: 1", "plan_format: 2"), /plan_format must be 1/],
    ["unknown frontmatter key", (t) => t.replace("version: 1", "version: 1\nmodel: opus"), /unknown key "model"/],
    ["bad type", (t) => t.replace("type: feature", "type: epic"), /type must be one of/],
    ["missing section", (t) => t.replace("## Risks\n\n- The provider rate-limits token exchanges during tests: the tests mock the endpoint\n\n", ""), /missing section "## Risks"/],
    ["empty list section", (t) => t.replace("## Out of Scope\n\n- Other OAuth providers", "## Out of Scope\n"), /"## Out of Scope" needs list items/],
    ["context after milestones", (t) => t.replace("## Risks", "## Notes\n\nlate\n\n## Risks"), /"## Notes" must come before/],
    ["sections out of order", (t) => t.replace("## Open Questions\n\n- None\n\n", "").replace("## Risks", "## Open Questions\n\n- None\n\n## Risks"), /out of order/],
    ["bad milestone heading", (t) => t.replace("### M2: Add the login route", "### Step 2: Add the login route"), /heading must be/],
    ["duplicate ID", (t) => t.replace("### M2:", "### M1:").replace("**Depends**: M1", "**Depends**: none"), /duplicate ID/],
    ["missing field", (t) => t.replace("- **Complexity**: low\n", ""), /missing field "\*\*Complexity\*\*"/],
    ["unknown field", (t) => t.replace("- **Complexity**: low", "- **Complexity**: low\n- **Model**: opus"), /unknown field "Model"/],
    ["bad complexity", (t) => t.replace("**Complexity**: low", "**Complexity**: trivial"), /complexity must be one of/],
    ["unknown dependency", (t) => t.replace("**Depends**: M1", "**Depends**: M7"), /unknown milestone M7/],
    ["forward dependency", (t) => t.replace("**Depends**: none", "**Depends**: M2"), /comes later/],
    ["missing subsection", (t) => t.replace("#### Acceptance Criteria\n\n- A successful callback creates a session and redirects to `/`\n\n", ""), /missing subsection "#### Acceptance Criteria"/],
    ["unknown subsection", (t) => t.replace("#### Tasks", "#### Steps"), /unknown subsection "#### Steps"/],
    ["validation without command", (t) => t.replace("- `pnpm lint`", "- run the linter"), /must start with a command in backticks/],
    ["no milestones", (t) => t.replace(/## Milestones[\s\S]*?## Risks/, "## Milestones\n\nTBD\n\n## Risks"), /has no "### M<n>/]
  ];
  for (const [name, mutate, pattern] of invalid) {
    test(`rejects: ${name}`, () => {
      const errors = errorsOf(mutate(EXAMPLE));
      assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
    });
  }

  test("checks the version against the file name", () => {
    assert.deepEqual(errorsOf(EXAMPLE, { file: "/x/plan.md" }), []);
    assert.match(errorsOf(EXAMPLE, { file: "/x/plan.v2.md" })[0], /does not match the file name/);
    const v3 = EXAMPLE.replace("version: 1", "version: 3");
    assert.deepEqual(errorsOf(v3, { file: "/x/plan.v3.md" }), []);
  });
});

describe("diffPlans", () => {
  const v1 = parsePlan(EXAMPLE).plan;
  const amendedText = EXAMPLE.replace("version: 1", "version: 2")
    .replace("**Complexity**: low", "**Complexity**: medium")
    .replace("## Risks", "### M3: Add logout\n\n- **Goal**: Users can sign out\n- **Complexity**: low\n- **Depends**: M2\n- **Files**: `src/routes/logout.ts`\n\n#### Tasks\n\n1. Add `/logout`\n\n#### Acceptance Criteria\n\n- The session is destroyed\n\n#### Validation\n\n- `pnpm test`\n\n## Risks");
  const v2 = parsePlan(amendedText).plan;

  test("reports changed and added milestones", () => {
    const report = diffPlans(v1, v2, ["M1"]);
    assert.equal(report.valid, true, JSON.stringify(report.errors));
    assert.deepEqual(report.unchanged, ["M1"]);
    assert.deepEqual(report.changed, ["M2"]);
    assert.deepEqual(report.added, ["M3"]);
    assert.deepEqual(report.removed, []);
    assert.deepEqual(report.affects, ["M2", "M3"]);
  });

  test("rejects a change to a completed milestone", () => {
    const report = diffPlans(v1, v2, ["M1", "M2"]);
    assert.equal(report.valid, false);
    assert.match(report.errors[0], /completed milestone M2 was changed/);
  });

  test("rejects removing a completed milestone and skipping a version", () => {
    const text = EXAMPLE.replace("version: 1", "version: 3").replace(/### M1:[\s\S]*?### M2/, "### M2").replace("**Depends**: M1", "**Depends**: none");
    const report = diffPlans(v1, parsePlan(text).plan, ["M1"]);
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((e) => /must be 2, got 3/.test(e)));
    assert.ok(report.errors.some((e) => /M1 was removed/.test(e)));
    assert.deepEqual(report.removed, ["M1"]);
  });
});

describe("CLI", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "esp-plan-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("parse prints JSON and lint passes on a valid plan", () => {
    const file = join(dir, "plan.md");
    writeFileSync(file, EXAMPLE);
    const parsed = cli(["parse", file]);
    assert.equal(parsed.code, 0, parsed.stderr);
    assert.deepEqual(parsed.json().milestones.map((m) => m.id), ["M1", "M2"]);
    const lint = cli(["lint", file]);
    assert.equal(lint.code, 0);
    assert.deepEqual(lint.json(), { file, valid: true, version: 1, milestones: ["M1", "M2"], errors: [], warnings: [] });
  });

  test("parse and lint exit 1 on an invalid plan, 2 on usage errors", () => {
    const file = join(dir, "plan.md");
    writeFileSync(file, EXAMPLE.replace("**Complexity**: low", "**Complexity**: huge"));
    assert.equal(cli(["parse", file]).code, 1);
    const lint = cli(["lint", file]);
    assert.equal(lint.code, 1);
    assert.equal(lint.json().valid, false);
    assert.equal(cli(["lint"]).code, 2);
    assert.equal(cli(["nope"]).code, 2);
    assert.equal(cli(["lint", join(dir, "missing.md")]).code, 1);
  });

  test("amendment flow: diff reads state.json, then runs.mjs amend logs it", () => {
    const home = join(dir, "home");
    const env = { ESP_SKILLS_HOME: home, ESP_RUNS_NOW: "2026-11-08T10:00:00.000Z" };
    const created = cli(["create", "oauth", "--root", join(dir, "runs"), "--project-dir", dir], RUNS, env);
    assert.equal(created.code, 0, created.stderr);
    const runDir = created.json().run_dir;
    writeFileSync(join(runDir, "plan.md"), EXAMPLE);
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ milestones: { M1: { status: "done" }, M2: { status: "pending" } } }));
    assert.deepEqual(completedFromState(runDir), ["M1"]);

    // Changing the completed milestone fails.
    writeFileSync(join(runDir, "plan.v2.md"), EXAMPLE.replace("version: 1", "version: 2").replace("**Complexity**: medium", "**Complexity**: high"));
    const bad = cli(["diff", join(runDir, "plan.md"), join(runDir, "plan.v2.md"), "--run-dir", runDir]);
    assert.equal(bad.code, 1);
    assert.match(bad.json().errors.join("\n"), /completed milestone M1 was changed/);

    // Changing only the remaining milestone passes.
    writeFileSync(join(runDir, "plan.v2.md"), EXAMPLE.replace("version: 1", "version: 2").replace("**Complexity**: low", "**Complexity**: medium"));
    const good = cli(["diff", join(runDir, "plan.md"), join(runDir, "plan.v2.md"), "--run-dir", runDir]);
    assert.equal(good.code, 0, good.stdout);
    assert.deepEqual(good.json().affects, ["M2"]);

    const amended = cli(["amend", "--run-dir", runDir, "--text", "M2 needs a session check", "--affects", good.json().affects.join(",")], RUNS, env);
    assert.equal(amended.code, 0, amended.stderr);
    assert.equal(amended.json().plan_version, 2);
    const decisions = readFileSync(join(runDir, "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(decisions.at(-1).refs, ["A001", "M2"]);
  });
});
