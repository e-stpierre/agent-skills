// Harness contract v1 (draft): schemas, status vocabulary and exit codes.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./json-schema.mjs";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_VERSION = 1;
export const CONTRACT_DIR = resolve(
  LIB_DIR,
  "..",
  "..",
  "references",
  "contract",
  `v${CONTRACT_VERSION}`
);

/** Artifact names, mapped to their schema file (without `.schema.json`). */
export const ARTIFACTS = [
  "run",
  "result",
  "needs-input",
  "inbox-message",
  "amendment",
  "event",
  "decision",
  "summary-frontmatter"
];

export const RISK_ORDER = ["low", "medium", "high"];

export const TERMINAL_RUN_STATUSES = [
  "halted",
  "failed",
  "canceled",
  "done",
  "merged"
];

/** Exit code per result status. Plain skills only use 0 and 1. */
export const EXIT_CODES = {
  done: 0,
  merged: 0,
  "awaiting-human": 10,
  halted: 20,
  escalate: 30,
  failed: 1
};

/** run.json status change -> event type emitted for it. */
export const RUN_STATUS_EVENTS = {
  paused: "run.paused",
  canceled: "run.canceled",
  halted: "run.halted",
  failed: "run.failed",
  done: "run.completed",
  merged: "run.completed"
};

let cache;

/** Load every contract schema, keyed by artifact name. */
export function loadSchemas() {
  if (cache) return cache;
  const schemas = {};
  for (const file of readdirSync(CONTRACT_DIR)) {
    if (!file.endsWith(".schema.json")) continue;
    schemas[file.slice(0, -".schema.json".length)] = JSON.parse(
      readFileSync(join(CONTRACT_DIR, file), "utf8")
    );
  }
  cache = schemas;
  return schemas;
}

/**
 * Validate a value against one contract artifact schema.
 * @returns {{ valid: boolean, errors: { path: string, message: string }[] }}
 */
export function validateArtifact(artifact, value) {
  const schemas = loadSchemas();
  const schema = schemas[artifact];
  if (!schema) throw new Error(`Unknown contract artifact: ${artifact}`);
  return validate(schema, value, { schemas: Object.values(schemas) });
}

/** Exit code for a result status (unknown statuses map to 1). */
export function exitCodeFor(status) {
  return EXIT_CODES[status] ?? 1;
}

/** Return the higher of two risk levels (null-safe). */
export function maxRisk(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a;
}

/**
 * Parse flat YAML frontmatter (`key: scalar` lines) from a markdown document.
 * Returns null when the document has no frontmatter.
 */
export function parseFrontmatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/.exec(text);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`Unsupported frontmatter line: ${line}`);
    data[kv[1]] = parseScalar(kv[2].trim());
  }
  return data;
}

function parseScalar(raw) {
  if (raw === "" || raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (/^".*"$/.test(raw)) return JSON.parse(raw);
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}
