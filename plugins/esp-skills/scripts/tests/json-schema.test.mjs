import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validate } from "../lib/json-schema.mjs";

const paths = (result) => result.errors.map((e) => e.path);

describe("json-schema validator", () => {
  test("type, enum and const", () => {
    assert.equal(validate({ type: "integer" }, 3).valid, true);
    assert.equal(validate({ type: "integer" }, 3.5).valid, false);
    assert.equal(validate({ type: ["string", "null"] }, null).valid, true);
    assert.equal(validate({ enum: ["a", "b"] }, "c").valid, false);
    assert.equal(validate({ const: 1 }, 1).valid, true);
  });

  test("objects: required, additionalProperties, patternProperties", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" } },
      patternProperties: { "^x-": { type: "number" } },
      additionalProperties: false
    };
    assert.equal(validate(schema, { a: "ok", "x-n": 1 }).valid, true);
    assert.deepEqual(paths(validate(schema, { b: 1 })), ["a", "b"]);
    assert.deepEqual(paths(validate(schema, { a: "ok", "x-n": "no" })), [
      "x-n"
    ]);
  });

  test("inherited prototype names are not declared properties", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false
    };
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      assert.deepEqual(paths(validate(schema, { a: "ok", [key]: 42 })), [key]);
    }
    const proto = JSON.parse('{"a":"ok","__proto__":42}');
    assert.deepEqual(paths(validate(schema, proto)), ["__proto__"]);
    assert.deepEqual(
      paths(validate({ type: "object", required: ["toString"] }, {})),
      ["toString"]
    );
  });

  test("date and date-time reject impossible calendar values", () => {
    const dt = { type: "string", format: "date-time" };
    const d = { type: "string", format: "date" };
    assert.equal(validate(dt, "2026-02-30T10:00:00Z").valid, false);
    assert.equal(validate(dt, "2026-04-31T10:00:00Z").valid, false);
    assert.equal(validate(dt, "2026-13-01T10:00:00Z").valid, false);
    assert.equal(validate(dt, "2026-11-08T24:00:00Z").valid, false);
    assert.equal(validate(dt, "2026-11-08T10:60:00Z").valid, false);
    assert.equal(validate(dt, "2026-11-08T10:00:00+25:00").valid, false);
    assert.equal(validate(dt, "2028-02-29T23:59:60.5-05:00").valid, true);
    assert.equal(validate(d, "2026-02-29").valid, false);
    assert.equal(validate(d, "1900-02-29").valid, false);
    assert.equal(validate(d, "2000-02-29").valid, true);
    assert.equal(validate(d, "2026-00-10").valid, false);
  });

  test("arrays: items, minItems, uniqueItems", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      uniqueItems: true
    };
    assert.equal(validate(schema, ["a"]).valid, true);
    assert.deepEqual(paths(validate(schema, ["a", 1])), ["[1]"]);
    assert.equal(validate(schema, []).valid, false);
    assert.equal(validate(schema, ["a", "a"]).valid, false);
  });

  test("strings and numbers: pattern, length, bounds, formats", () => {
    assert.equal(
      validate({ type: "string", pattern: "^a" }, "abc").valid,
      true
    );
    assert.equal(validate({ type: "string", minLength: 2 }, "a").valid, false);
    assert.equal(validate({ type: "number", minimum: 0 }, -1).valid, false);
    assert.equal(validate({ type: "number", maximum: 1 }, 2).valid, false);
    assert.equal(
      validate({ type: "string", format: "date-time" }, "2026-11-08T10:00:00Z")
        .valid,
      true
    );
    assert.equal(
      validate({ type: "string", format: "date-time" }, "yesterday").valid,
      false
    );
  });

  test("combinators and local $ref", () => {
    const schema = {
      $defs: { pos: { type: "integer", minimum: 1 } },
      type: "object",
      properties: {
        a: { $ref: "#/$defs/pos" },
        b: { anyOf: [{ type: "string" }, { type: "null" }] },
        c: { oneOf: [{ type: "integer" }, { type: "number" }] },
        d: { not: { type: "null" } }
      }
    };
    assert.equal(validate(schema, { a: 2, b: null, d: 1 }).valid, true);
    assert.deepEqual(paths(validate(schema, { a: 0 })), ["a"]);
    assert.equal(validate(schema, { b: 1 }).valid, false);
    assert.equal(validate(schema, { c: 1 }).valid, false);
    assert.equal(validate(schema, { c: 1.5 }).valid, true);
    assert.equal(validate(schema, { d: null }).valid, false);
  });

  test("nested paths are dotted", () => {
    const schema = {
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: { b: { type: "array", items: { type: "boolean" } } }
        }
      }
    };
    const result = validate(schema, { a: { b: [true, "x"] } });
    assert.equal(result.errors[0].path, "a.b[1]");
    assert.match(result.errors[0].message, /expected boolean, got string "x"/);
  });
});
