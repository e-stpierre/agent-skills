// Pull request body built from run artifacts.
//
// Shared by the workflow skills (esp-go-light now, esp-pr and esp-go later):
// the body is rendered from files in the run directory, never from the
// model's memory, so it can be refreshed before the merge and stays in sync
// with decisions.jsonl and the step results.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BODY_SECTIONS = ["summary", "milestones", "decisions", "review-resolution", "follow-ups"];
export const ATTRIBUTION = "\u{1F916} Generated with [Claude Code](https://claude.com/product/claude-code)";
const RISK_RANK = { high: 0, medium: 1, low: 2 };
const SKIPPED_DECISION_PHASES = new Set(["fix-review", "merge"]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** Step results of a run, in step order: [{ step, name, result }]. */
export function readStepResults(runDir) {
  const stepsDir = join(runDir, "steps");
  if (!existsSync(stepsDir)) return [];
  return readdirSync(stepsDir)
    .filter((d) => /^\d+-/.test(d))
    .sort()
    .flatMap((step) => {
      const result = readJson(join(stepsDir, step, "result.json"));
      return result ? [{ step, name: step.replace(/^\d+-/, ""), result }] : [];
    });
}

/** Everything the body needs, read from the run directory. */
export function collectRunArtifacts(runDir) {
  return {
    decisions: readJsonl(join(runDir, "decisions.jsonl")),
    steps: readStepResults(runDir),
    build: readJson(join(runDir, "state.json"))
  };
}

const short = (sha) => (sha ? String(sha).slice(0, 7) : null);

function milestonesSection({ build }) {
  if (!build?.milestones || !Array.isArray(build.order)) return null;
  const lines = build.order.map((id) => {
    const m = build.milestones[id] ?? {};
    const commit = short(m.commit);
    return `- ${id}: ${m.title ?? id}${commit ? ` (${commit})` : ""}${m.status === "done" ? "" : ` - ${m.status}`}`;
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function decisionsSection({ decisions }) {
  const shown = decisions
    .filter((d) => !SKIPPED_DECISION_PHASES.has(d.phase))
    .map((d, index) => ({ d, index }))
    .sort((a, b) => (RISK_RANK[a.d.risk] ?? 3) - (RISK_RANK[b.d.risk] ?? 3) || a.index - b.index)
    .map(({ d }) => {
      const tags = [d["x-esp-class"], d.risk].filter(Boolean).join(", ");
      return `- ${d.id}${tags ? ` (${tags})` : ""}: ${d.decision}`;
    });
  return shown.length > 0 ? shown.join("\n") : null;
}

function reviewResolutionSection({ steps, decisions }) {
  const lines = [];
  for (const { name, result } of steps) {
    if (!/^fix-review(-\d+)?$/.test(name)) continue;
    const o = result.outputs ?? {};
    const where = o.mode === "internal" ? "Internal review" : `PR review${o.pr ? ` #${o.pr}` : ""}`;
    const counts = ["fixed", "rejected", "deferred", "open"]
      .filter((k) => Number.isInteger(o[k]) && o[k] > 0)
      .map((k) => `${o[k]} ${k}`);
    const rounds = Number.isInteger(o.rounds) ? `, ${o.rounds} round${o.rounds === 1 ? "" : "s"}` : "";
    lines.push(`- ${where}: ${counts.length > 0 ? counts.join(", ") : "nothing to fix"}${rounds}`);
  }
  for (const d of decisions) {
    if (d.phase === "fix-review" && d["x-esp-class"] === "Reject") lines.push(`  - Rejected (${d.id}): ${d.decision}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function followUpsSection({ steps }) {
  const seen = new Set();
  const lines = [];
  for (const { result } of steps) {
    for (const item of result.discovered_items ?? []) {
      const key = `${item.type}:${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${item.type}: ${item.title}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

const RENDERERS = {
  milestones: ["Milestones", milestonesSection],
  decisions: ["Decisions", decisionsSection],
  "review-resolution": ["Review Resolution", reviewResolutionSection],
  "follow-ups": ["Follow-ups", followUpsSection]
};

/**
 * Render the body. `summary` is the only free text (written by the caller).
 * Sections other than the summary are left out when they have nothing to show.
 */
export function renderPrBody(artifacts, { summary, sections = BODY_SECTIONS, attribution = ATTRIBUTION } = {}) {
  const parts = [];
  for (const section of sections) {
    if (section === "summary") {
      if (summary) parts.push(`## Summary\n\n${summary.trim()}`);
      continue;
    }
    const renderer = RENDERERS[section];
    if (!renderer) continue;
    const [title, render] = renderer;
    const body = render(artifacts);
    if (body) parts.push(`## ${title}\n\n${body}`);
  }
  if (attribution) parts.push(attribution);
  return `${parts.join("\n\n")}\n`;
}
