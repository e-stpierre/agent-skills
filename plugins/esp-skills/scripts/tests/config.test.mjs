import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULTS_PATH,
  SCHEMA_PATH,
  SCHEMA_URL,
  deepMerge,
  expandHome,
  getValue,
  loadConfig,
  parseValue,
  setValue
} from "../config.mjs";
import { validate } from "../lib/json-schema.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config.mjs"
);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
};

let root;
let home;
let project;
let env;

function cli(...args) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, ...args, "--project-dir", project],
    {
      env: { ...process.env, ESP_SKILLS_HOME: home },
      encoding: "utf8"
    }
  );
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout)
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "esp-config-"));
  home = join(root, "home");
  project = join(root, "repo");
  mkdirSync(project, { recursive: true });
  env = { ESP_SKILLS_HOME: home };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("schema and defaults", () => {
  test("config.schema.json validates config-defaults.json", () => {
    const result = validate(readJson(SCHEMA_PATH), readJson(DEFAULTS_PATH));
    assert.deepEqual(result.errors, []);
  });

  test("$schema URL of the defaults matches the schema $id and published path", () => {
    const schema = readJson(SCHEMA_PATH);
    const defaults = readJson(DEFAULTS_PATH);
    assert.equal(defaults.$schema, schema.$id);
    assert.equal(schema.$id, SCHEMA_URL);
    assert.ok(
      SCHEMA_URL.endsWith("/plugins/esp-skills/references/config.schema.json")
    );
  });
});

describe("helpers", () => {
  test("deepMerge merges objects and replaces arrays and null", () => {
    const merged = deepMerge(
      { a: { b: 1, c: [1, 2] }, d: "x", e: { f: 1 } },
      { a: { c: [3] }, e: null, g: true }
    );
    assert.deepEqual(merged, { a: { b: 1, c: [3] }, d: "x", e: null, g: true });
  });

  test("getValue and setValue use dotted paths", () => {
    const config = setValue({}, "a.b.c", 1);
    assert.deepEqual(config, { a: { b: { c: 1 } } });
    assert.equal(getValue(config, "a.b.c"), 1);
    assert.equal(getValue(config, "a.x"), undefined);
    assert.deepEqual(setValue(config, "a.b.c", undefined), { a: { b: {} } });
  });

  test("parseValue reads JSON and falls back to strings", () => {
    assert.equal(parseValue("true"), true);
    assert.equal(parseValue("3"), 3);
    assert.equal(parseValue("null"), null);
    assert.deepEqual(parseValue('["a"]'), ["a"]);
    assert.equal(parseValue("develop"), "develop");
  });

  test("expandHome expands a leading tilde only", () => {
    assert.equal(expandHome("~/runs", "/h"), join("/h", "runs"));
    assert.equal(expandHome("/abs/~/x", "/h"), "/abs/~/x");
  });
});

describe("layering", () => {
  test("missing user and project files fall back to defaults", () => {
    const { config, layers } = loadConfig({ projectDir: project, env });
    assert.deepEqual(config.branch, readJson(DEFAULTS_PATH).branch);
    assert.deepEqual(
      layers.map((l) => [l.layer, l.used]),
      [
        ["defaults", true],
        ["user", false],
        ["project", false]
      ]
    );
  });

  test("project overrides user, which overrides defaults", () => {
    writeJson(join(home, "config.json"), {
      version: 1,
      pr: { draft: true, base: "develop" },
      commit: { style: "conventional" }
    });
    writeJson(join(project, ".esp-skills", "config.json"), {
      pr: { base: "trunk" }
    });
    const { config } = loadConfig({ projectDir: project, env });
    assert.equal(config.pr.base, "trunk");
    assert.equal(config.pr.draft, true);
    assert.equal(config.pr.attribution, true);
    assert.equal(config.commit.style, "conventional");
  });

  test("a snapshot replaces the user and project layers", () => {
    writeJson(join(home, "config.json"), { pr: { draft: true } });
    writeJson(join(project, ".esp-skills", "config.json"), {
      pr: { base: "trunk" }
    });
    const snapshot = join(root, "snapshot.json");
    writeJson(snapshot, { pr: { base: "release" } });
    const { config, layers } = loadConfig({
      projectDir: project,
      snapshot,
      env
    });
    assert.equal(config.pr.base, "release");
    assert.equal(config.pr.draft, false);
    assert.deepEqual(
      layers.filter((l) => l.used).map((l) => l.layer),
      ["defaults", "snapshot"]
    );
  });

  test("a missing snapshot fails", () => {
    assert.throws(
      () =>
        loadConfig({
          projectDir: project,
          snapshot: join(root, "none.json"),
          env
        }),
      /snapshot not found/
    );
  });
});

describe("cli get and show", () => {
  test("get <skill> prints the merged section as JSON", () => {
    writeJson(join(project, ".esp-skills", "config.json"), {
      analyze: { output_dir: "reports" }
    });
    const result = cli("get", "analyze");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.json(), { output_dir: "reports" });
  });

  test("get accepts dotted keys", () => {
    const result = cli("get", "defaults.models.builder.high");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.json(), { model: "opus", effort: "high" });
  });

  test("get of an unknown key exits 2", () => {
    const result = cli("get", "nope");
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Unknown config key: nope/);
  });

  test("show output is a valid snapshot", () => {
    writeJson(join(home, "config.json"), { pr: { draft: true } });
    const shown = cli("show");
    assert.equal(shown.code, 0, shown.stderr);
    const snapshot = join(root, "snap.json");
    writeFileSync(snapshot, shown.stdout);
    rmSync(join(home, "config.json"));
    const result = cli("get", "pr.draft", "--config-snapshot", snapshot);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json(), true);
  });

  test("sources lists every layer", () => {
    const result = cli("sources");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      result.json().map((l) => l.layer),
      ["defaults", "user", "project"]
    );
  });
});

describe("invalid config", () => {
  test("a wrong type fails with the key path, expected type and source", () => {
    writeJson(join(home, "config.json"), { pr: { draft: "yes" } });
    const result = cli("get", "pr");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /config\.json/);
    assert.match(
      result.stderr,
      /pr\.draft: expected boolean, got string "yes"/
    );
  });

  test("an invalid enum value lists the allowed values", () => {
    writeJson(join(project, ".esp-skills", "config.json"), {
      review: { min_severity: "urgent" }
    });
    const result = cli("get", "review");
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /review\.min_severity: expected one of "low", "medium", "high", "critical"/
    );
  });

  test("an unknown key is rejected", () => {
    writeJson(join(home, "config.json"), { branch: { patern: "x" } });
    const result = cli("validate");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /branch\.patern: is not a known key/);
  });

  test("nested model choices are validated", () => {
    writeJson(join(home, "config.json"), {
      defaults: { models: { builder: { low: { model: "gpt" } } } }
    });
    const result = cli("validate");
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /defaults\.models\.builder\.low\.model: expected one of/
    );
  });

  test("malformed JSON fails loudly", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), "{ not json");
    const result = cli("show");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /invalid JSON/);
  });
});

describe("cli init, set, unset, validate", () => {
  test("init creates a starter user file and is idempotent", () => {
    const first = cli("init");
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.json().created, true);
    assert.deepEqual(readJson(join(home, "config.json")), {
      $schema: SCHEMA_URL,
      version: 1
    });
    const second = cli("init");
    assert.equal(second.json().created, false);
    const forced = cli("init", "--force");
    assert.equal(forced.json().created, true);
  });

  test("init --project writes the project file", () => {
    const result = cli("init", "--project");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      readJson(join(project, ".esp-skills", "config.json")).version,
      1
    );
  });

  test("set writes typed values and get reads them back", () => {
    assert.equal(cli("set", "pr.draft", "true").code, 0);
    assert.equal(cli("set", "pr.base", "develop", "--project").code, 0);
    assert.equal(readJson(join(home, "config.json")).pr.draft, true);
    assert.equal(
      readJson(join(project, ".esp-skills", "config.json")).pr.base,
      "develop"
    );
    const pr = cli("get", "pr").json();
    assert.equal(pr.draft, true);
    assert.equal(pr.base, "develop");
  });

  test("set rejects an invalid value and leaves the file unchanged", () => {
    cli("set", "pr.draft", "true");
    const result = cli("set", "pr.draft", "maybe");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /pr\.draft: expected boolean/);
    assert.equal(readJson(join(home, "config.json")).pr.draft, true);
  });

  test("set rejects an unknown key", () => {
    const result = cli("set", "nope.key", "1");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /nope: is not a known key/);
  });

  test("unset removes a key", () => {
    cli("set", "pr.draft", "true");
    const result = cli("unset", "pr.draft");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json().removed, true);
    assert.equal(cli("get", "pr.draft").json(), false);
  });

  test("validate checks a single file", () => {
    const file = join(root, "candidate.json");
    writeJson(file, { merge: { method: "fast-forward" } });
    const bad = cli("validate", file);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /merge\.method/);
    writeJson(file, { merge: { method: "squash" } });
    assert.equal(cli("validate", file).code, 0);
  });

  test("validate reports a missing file", () => {
    const result = cli("validate", join(root, "missing.json"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /File not found/);
  });

  test("usage errors exit 2", () => {
    assert.equal(cli("frobnicate").code, 2);
    assert.equal(cli("set", "pr.draft").code, 2);
    assert.equal(cli("get", "--bogus").code, 2);
  });
});
