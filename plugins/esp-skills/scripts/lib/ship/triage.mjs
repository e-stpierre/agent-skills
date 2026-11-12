// Triage of a request: the input kind, the plan source, the track, the review
// mode and the workspace, decided before any branch or plan. Filled by the
// triage phase; until then the caller passes --track to init.

export const INPUT_KINDS = ["plan", "task-list", "document", "prompt", "issue"];
export const PLAN_SOURCES = [
  "reuse",
  "import",
  "generate",
  "synthesize",
  "none"
];
