// Gate commands: the configured ones, else detected from the project files.
// Scoping the gates to a milestone (and the final gates before the push) is
// added on top of this module.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome, loadConfig } from "../../config.mjs";
import { shipSettings } from "./state.mjs";

export const GATE_NAMES = ["test", "lint", "typecheck", "build"];

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function packageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    return "bun";
  return "npm";
}

/** Detect gate commands from the project files at `root`. */
export function detectGates(root) {
  const gates = Object.fromEntries(GATE_NAMES.map((g) => [g, null]));
  const pkgText = readText(join(root, "package.json"));
  if (pkgText) {
    let scripts = {};
    try {
      scripts = JSON.parse(pkgText).scripts ?? {};
    } catch {
      scripts = {};
    }
    const pm = packageManager(root);
    const runScript = (name) =>
      pm === "npm"
        ? name === "test"
          ? "npm test"
          : `npm run ${name}`
        : `${pm} ${name}`;
    const pick = (...names) =>
      names.find((n) => typeof scripts[n] === "string");
    for (const [gate, names] of [
      ["test", ["test"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["build", ["build"]]
    ]) {
      const name = pick(...names);
      if (name && !(gate === "test" && /no test specified/.test(scripts[name])))
        gates[gate] = runScript(name);
    }
    return gates;
  }
  const pyproject = readText(join(root, "pyproject.toml"));
  if (pyproject !== null) {
    if (/\bpytest\b/.test(pyproject) || existsSync(join(root, "tests")))
      gates.test = "uv run pytest";
    if (/\[tool\.ruff/.test(pyproject)) gates.lint = "uv run ruff check";
    if (/\[tool\.mypy/.test(pyproject)) gates.typecheck = "uv run mypy .";
    return gates;
  }
  if (existsSync(join(root, "Cargo.toml")))
    return {
      test: "cargo test",
      lint: "cargo clippy",
      typecheck: null,
      build: "cargo build"
    };
  if (existsSync(join(root, "go.mod")))
    return {
      test: "go test ./...",
      lint: "go vet ./...",
      typecheck: null,
      build: "go build ./..."
    };
  const makefile = readText(join(root, "Makefile"));
  if (makefile) {
    for (const gate of ["test", "lint", "build"])
      if (new RegExp(`^${gate}:`, "m").test(makefile))
        gates[gate] = `make ${gate}`;
  }
  return gates;
}

/** Gate commands of a project: configured first, else detected, else none. */
export function resolveGates(root, config) {
  const configured = shipSettings(config).gates ?? {};
  const detected = detectGates(root);
  const gates = {};
  const sources = {};
  for (const g of GATE_NAMES) {
    if (configured[g]) [gates[g], sources[g]] = [configured[g], "config"];
    else if (detected[g]) [gates[g], sources[g]] = [detected[g], "detected"];
    else [gates[g], sources[g]] = [null, "none"];
  }
  return { project_dir: root, gates, sources };
}

export function gatesFor({ projectDir, snapshot } = {}) {
  const root = resolve(expandHome(String(projectDir ?? process.cwd())));
  return resolveGates(root, loadConfig({ snapshot, projectDir: root }).config);
}
