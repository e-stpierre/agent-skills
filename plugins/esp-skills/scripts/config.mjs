#!/usr/bin/env node
// esp-skills configuration resolver.
//
// Layers, lowest to highest precedence:
//   1. Built-in defaults: references/config-defaults.json
//   2. User config: ~/.esp-skills/config.json (ESP_SKILLS_HOME overrides ~/.esp-skills)
//   3. Project config: <repo>/.esp-skills/config.json
//   4. --config-snapshot <path>: replaces layers 2 and 3 (defaults still fill missing keys)
// Skill arguments are applied by the calling skill, on top of the resolved value.
//
// Exit codes: 0 success, 1 invalid config or failed operation, 2 usage error.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");
export const DEFAULTS_PATH = join(
  PLUGIN_ROOT,
  "references",
  "config-defaults.json"
);
export const SCHEMA_PATH = join(
  PLUGIN_ROOT,
  "references",
  "config.schema.json"
);
export const SCHEMA_URL =
  "https://raw.githubusercontent.com/e-stpierre/skills/main/plugins/esp-skills/references/config.schema.json";

export class ConfigError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "ConfigError";
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand a leading `~` to the home directory. */
export function expandHome(path, home = homedir()) {
  if (typeof path !== "string") return path;
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\"))
    return join(home, path.slice(2));
  return path;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: objects merge key by key, everything else (arrays, scalars, null) replaces. */
export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override))
    return structuredClone(override);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : structuredClone(value);
  }
  return out;
}

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(
      `${path}: cannot read file (${err.code ?? err.message})`
    );
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new ConfigError(`${path}: invalid JSON (${err.message})`);
  }
}

let cachedSchema;
export function loadSchema() {
  cachedSchema ??= readJson(SCHEMA_PATH);
  return cachedSchema;
}

/** Validate a config object; throw a ConfigError naming the source, key path and expected type. */
export function assertValid(config, source) {
  const result = validate(loadSchema(), config);
  if (!result.valid) {
    const lines = result.errors.map((e) => `  ${e.path}: ${e.message}`);
    throw new ConfigError(`Invalid config in ${source}:\n${lines.join("\n")}`);
  }
}

/** Find the repository root (nearest directory with `.git`) from `start`, or null. */
export function findRepoRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve the file locations of every layer. */
export function layerPaths({ projectDir, snapshot, env = process.env } = {}) {
  const espHome = env.ESP_SKILLS_HOME
    ? resolve(env.ESP_SKILLS_HOME)
    : join(homedir(), ".esp-skills");
  const project = projectDir
    ? resolve(projectDir)
    : (findRepoRoot() ?? process.cwd());
  return {
    defaults: DEFAULTS_PATH,
    user: join(espHome, "config.json"),
    project: join(project, ".esp-skills", "config.json"),
    snapshot: snapshot ? resolve(snapshot) : null
  };
}

/**
 * Load and merge every layer.
 * @returns {{ config: object, layers: { layer: string, path: string, used: boolean }[] }}
 */
export function loadConfig(options = {}) {
  const paths = layerPaths(options);
  const layers = [];

  const defaults = readJson(paths.defaults);
  assertValid(defaults, paths.defaults);
  let config = defaults;
  layers.push({ layer: "defaults", path: paths.defaults, used: true });

  if (paths.snapshot) {
    if (!existsSync(paths.snapshot)) {
      throw new ConfigError(`Config snapshot not found: ${paths.snapshot}`);
    }
    const snapshot = readJson(paths.snapshot);
    assertValid(snapshot, paths.snapshot);
    config = deepMerge(config, snapshot);
    layers.push({ layer: "user", path: paths.user, used: false });
    layers.push({ layer: "project", path: paths.project, used: false });
    layers.push({ layer: "snapshot", path: paths.snapshot, used: true });
  } else {
    for (const layer of ["user", "project"]) {
      const path = paths[layer];
      // The project layer can point at the same file as the user layer (repo at ~).
      const duplicate = layer === "project" && path === paths.user;
      const used = !duplicate && existsSync(path) && statSync(path).isFile();
      if (used) {
        const data = readJson(path);
        assertValid(data, path);
        config = deepMerge(config, data);
      }
      layers.push({ layer, path, used });
    }
  }

  config.$schema = SCHEMA_URL;
  assertValid(config, "merged config");
  return { config, layers };
}

function splitKey(key) {
  if (!key || typeof key !== "string")
    throw new ConfigError("A config key is required", 2);
  return key.split(".").filter((p) => p !== "");
}

/** Read the value at a dotted key path, or undefined. */
export function getValue(config, key) {
  let node = config;
  for (const part of splitKey(key)) {
    if (!isPlainObject(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Return a copy of `config` with the value at a dotted key path set (or removed when value is undefined). */
export function setValue(config, key, value) {
  const parts = splitKey(key);
  const out = structuredClone(config);
  let node = out;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part];
  }
  const last = parts.at(-1);
  if (value === undefined) delete node[last];
  else node[last] = value;
  return out;
}

/** Parse a CLI value: JSON when it parses, otherwise a plain string. */
export function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function starterConfig() {
  return { $schema: SCHEMA_URL, version: 1 };
}

function writeConfigFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function cmdGet(key, options) {
  const { config } = loadConfig(options);
  const value = getValue(config, key);
  if (value === undefined)
    throw new ConfigError(`Unknown config key: ${key}`, 2);
  return value;
}

export function cmdShow(options) {
  return loadConfig(options).config;
}

export function cmdSources(options) {
  return loadConfig(options).layers;
}

export function cmdInit(options) {
  const paths = layerPaths(options);
  const target = options.project ? paths.project : paths.user;
  if (existsSync(target) && !options.force) {
    return {
      path: target,
      created: false,
      message: "Config file already exists (use --force to overwrite)"
    };
  }
  writeConfigFile(target, starterConfig());
  return { path: target, created: true };
}

export function cmdSet(key, rawValue, options) {
  if (rawValue === undefined)
    throw new ConfigError("Usage: set <key> <value>", 2);
  const paths = layerPaths(options);
  const target = options.project ? paths.project : paths.user;
  const current = existsSync(target) ? readJson(target) : starterConfig();
  const value = parseValue(rawValue);
  const next = setValue(current, key, value);
  assertValid(next, `${target} (after set ${key})`);
  writeConfigFile(target, next);
  return { path: target, key, value };
}

export function cmdUnset(key, options) {
  const paths = layerPaths(options);
  const target = options.project ? paths.project : paths.user;
  if (!existsSync(target)) return { path: target, key, removed: false };
  const current = readJson(target);
  const removed = getValue(current, key) !== undefined;
  const next = setValue(current, key, undefined);
  assertValid(next, target);
  writeConfigFile(target, next);
  return { path: target, key, removed };
}

export function cmdValidate(file, options) {
  if (file) {
    const path = resolve(file);
    if (!existsSync(path)) throw new ConfigError(`File not found: ${path}`);
    assertValid(readJson(path), path);
    return { valid: true, files: [path] };
  }
  const { layers } = loadConfig(options);
  return {
    valid: true,
    files: layers.filter((l) => l.used).map((l) => l.path)
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node config.mjs <command> [args] [options]

Commands:
  get <key>            Print the merged value of a section or dotted key (JSON)
  show                 Print the full merged config (JSON), usable as a snapshot
  sources              Print the layers and whether each was used (JSON)
  init                 Create a starter config file (user, or project with --project)
  set <key> <value>    Set a key in the user (or --project) file; value is JSON or a string
  unset <key>          Remove a key from the user (or --project) file
  validate [file]      Validate one file, or every layer and the merged result

Options:
  --config-snapshot <path>  Use a snapshot instead of the user and project layers
  --project-dir <dir>       Project root (default: nearest git root, else cwd)
  --project                 Target the project file for init, set and unset
  --force                   Overwrite an existing file on init
  --help                    Show this help`;

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config-snapshot" || arg === "--project-dir") {
      const value = argv[++i];
      if (value === undefined)
        throw new ConfigError(`${arg} requires a value`, 2);
      options[arg === "--config-snapshot" ? "snapshot" : "projectDir"] = value;
    } else if (arg.startsWith("--config-snapshot=")) {
      options.snapshot = arg.slice("--config-snapshot=".length);
    } else if (arg.startsWith("--project-dir=")) {
      options.projectDir = arg.slice("--project-dir=".length);
    } else if (arg === "--project") {
      options.project = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      throw new ConfigError(`Unknown option: ${arg}`, 2);
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function run(argv) {
  const { command, args, options } = parseArgs(argv);
  if (options.help || !command)
    return { output: USAGE, exitCode: command ? 0 : 2 };
  switch (command) {
    case "get":
      return { output: cmdGet(args[0], options) };
    case "show":
      return { output: cmdShow(options) };
    case "sources":
      return { output: cmdSources(options) };
    case "init":
      return { output: cmdInit(options) };
    case "set":
      return { output: cmdSet(args[0], args[1], options) };
    case "unset":
      return { output: cmdUnset(args[0], options) };
    case "validate":
      return { output: cmdValidate(args[0], options) };
    default:
      throw new ConfigError(`Unknown command: ${command}\n\n${USAGE}`, 2);
  }
}

function main() {
  try {
    const { output, exitCode = 0 } = run(process.argv.slice(2));
    const text =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`config error: ${err.message}\n`);
      process.exitCode = err.exitCode;
    } else {
      process.stderr.write(`config error: ${err.stack ?? err}\n`);
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
