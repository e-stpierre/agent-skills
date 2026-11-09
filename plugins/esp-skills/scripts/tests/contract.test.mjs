import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  ARTIFACTS,
  CONTRACT_DIR,
  EXIT_CODES,
  exitCodeFor,
  loadSchemas,
  maxRisk,
  parseFrontmatter,
  validateArtifact
} from "../lib/contract.mjs";

const FIXTURES = join(CONTRACT_DIR, "fixtures");

function fixtureFiles(artifact, kind) {
  const dir = join(FIXTURES, artifact, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      value: JSON.parse(readFileSync(join(dir, f), "utf8"))
    }));
}

describe("contract v1 schemas", () => {
  test("every artifact has a schema with a urn $id and draft marker", () => {
    const schemas = loadSchemas();
    for (const artifact of ARTIFACTS) {
      const schema = schemas[artifact];
      assert.ok(schema, `missing schema for ${artifact}`);
      assert.equal(schema.$id, `urn:harness-contract:v1:${artifact}`);
      assert.match(schema.title, /^Harness contract v1 \(draft\)/);
    }
  });

  test("schemas contain no plugin-specific paths or names", () => {
    for (const file of readdirSync(CONTRACT_DIR).filter((f) =>
      f.endsWith(".schema.json")
    )) {
      const text = readFileSync(join(CONTRACT_DIR, file), "utf8");
      assert.doesNotMatch(text, /esp-skills|plugins\/|agentic-forge/, file);
    }
  });

  for (const artifact of ARTIFACTS) {
    describe(artifact, () => {
      const valid = fixtureFiles(artifact, "valid");
      const invalid = fixtureFiles(artifact, "invalid");

      test("has valid and invalid fixtures", () => {
        assert.ok(valid.length > 0, "no valid fixtures");
        assert.ok(invalid.length > 0, "no invalid fixtures");
      });

      for (const { name, value } of valid) {
        test(`accepts valid/${name}`, () => {
          const result = validateArtifact(artifact, value);
          assert.deepEqual(result.errors, []);
        });
      }

      for (const { name, value } of invalid) {
        test(`rejects invalid/${name}`, () => {
          assert.equal(validateArtifact(artifact, value).valid, false);
        });
      }
    });
  }
});

describe("contract helpers", () => {
  test("exit codes follow the contract", () => {
    assert.deepEqual(EXIT_CODES, {
      done: 0,
      merged: 0,
      "awaiting-human": 10,
      halted: 20,
      escalate: 30,
      failed: 1
    });
    assert.equal(exitCodeFor("unknown"), 1);
  });

  test("maxRisk keeps the highest level", () => {
    assert.equal(maxRisk(null, "low"), "low");
    assert.equal(maxRisk("high", "medium"), "high");
    assert.equal(maxRisk("low", "high"), "high");
    assert.equal(maxRisk("medium", null), "medium");
  });

  test("parseFrontmatter reads the summary fixture", () => {
    const text = readFileSync(
      join(FIXTURES, "summary-frontmatter", "valid", "summary.md"),
      "utf8"
    );
    const data = parseFrontmatter(text);
    assert.deepEqual(
      data,
      JSON.parse(
        readFileSync(
          join(FIXTURES, "summary-frontmatter", "valid", "full.json"),
          "utf8"
        )
      )
    );
    assert.equal(parseFrontmatter("# no frontmatter"), null);
    assert.throws(() => parseFrontmatter("---\n- list\n---\n"), /Unsupported/);
  });
});
