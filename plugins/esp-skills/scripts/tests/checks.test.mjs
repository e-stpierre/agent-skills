import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CHECK_FIELDS,
  checkBucket,
  classifyChecks,
  fetchChecks
} from "../lib/checks.mjs";

class CustomError extends Error {}

const check = (name, bucket) => ({ name, state: bucket, bucket });

function runner(res) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "", ...res };
  };
  return { run, calls };
}

describe("fetchChecks", () => {
  test("asks gh for the check fields, with --required when asked", () => {
    const { run, calls } = runner({ stdout: "[]" });
    fetchChecks(run, 7);
    fetchChecks(run, 7, { required: true });
    assert.deepEqual(calls[0], ["pr", "checks", "7", "--json", CHECK_FIELDS]);
    assert.deepEqual(calls[1].slice(-1), ["--required"]);
  });

  test("accepts the JSON list on exit 0, 1 (failing) and 8 (pending)", () => {
    const list = [check("ci", "fail")];
    for (const status of [0, 1, 8]) {
      const { run } = runner({ status, stdout: JSON.stringify(list) });
      assert.deepEqual(fetchChecks(run, 7), list);
    }
  });

  test("no checks reported is an empty list", () => {
    const { run } = runner({
      status: 1,
      stderr: "no checks reported on the 'feature/x' branch"
    });
    assert.deepEqual(fetchChecks(run, 7), []);
    const required = runner({
      status: 1,
      stderr: "no required checks reported"
    });
    assert.deepEqual(fetchChecks(required.run, 7, { required: true }), []);
    assert.deepEqual(fetchChecks(runner({ status: 0 }).run, 7), []);
  });

  test("any other failure throws the caller's error class", () => {
    const { run } = runner({ status: 4, stderr: "HTTP 502" });
    assert.throws(
      () => fetchChecks(run, 7, { ErrorClass: CustomError }),
      (err) => err instanceof CustomError && /HTTP 502/.test(err.message)
    );
  });
});

describe("classifyChecks", () => {
  test("splits failing, pending and passing, skipped counts as passing", () => {
    const all = [
      check("a", "pass"),
      check("b", "fail"),
      check("c", "cancel"),
      check("d", "pending"),
      check("e", "skipping")
    ];
    assert.deepEqual(classifyChecks(all), {
      failing: ["b", "c"],
      pending: ["d"],
      passing: ["a", "e"],
      scope: "all"
    });
  });

  test("required-only scope, and unreported required checks are pending", () => {
    const all = [check("a", "fail"), check("b", "pass")];
    const required = [{ name: "b" }, { name: "c" }];
    assert.deepEqual(classifyChecks(all, required, { requireGreen: false }), {
      failing: [],
      pending: ["c"],
      passing: ["b"],
      scope: "required"
    });
  });

  test("checkBucket falls back to the state, lowercased", () => {
    assert.equal(checkBucket({ state: "PENDING" }), "pending");
    assert.equal(checkBucket({ bucket: "FAIL", state: "x" }), "fail");
    assert.equal(checkBucket(null), "");
  });
});
