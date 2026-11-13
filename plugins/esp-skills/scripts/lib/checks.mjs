// CI checks of a pull request head, shared by wait-for-review, fix-review and
// merge-ready: the `gh pr checks` fetch and the failing / pending / passing
// classification.

export const CHECK_FIELDS = "name,state,bucket,link,workflow";

/** The bucket of a check (`pass`, `fail`, `pending`, `skipping`, `cancel`). */
export function checkBucket(check) {
  return String(check?.bucket ?? check?.state ?? "").toLowerCase();
}

/**
 * Fetch the checks of a pull request through `run(args)`, which returns
 * `{ status, stdout, stderr }` for a gh command. `required` limits the list
 * to the required checks. "No checks reported" is an empty list. Any other
 * output that is not a JSON list throws `new ErrorClass(message)`.
 */
export function fetchChecks(
  run,
  number,
  { required = false, ErrorClass = Error } = {}
) {
  const args = ["pr", "checks", String(number), "--json", CHECK_FIELDS];
  if (required) args.push("--required");
  const res = run(args);
  const out = String(res.stdout ?? "").trim();
  const text = `${res.stderr ?? ""}\n${res.stdout ?? ""}`;
  // gh pr checks exits 8 while checks are pending and 1 when one failed,
  // with the JSON list on stdout in both cases.
  if (out.startsWith("[")) return JSON.parse(out);
  if (/no (required )?checks reported/i.test(text)) return [];
  if (res.status === 0 && out === "") return [];
  throw new ErrorClass(`gh pr checks failed: ${text.trim()}`);
}

/**
 * Classify checks: `{ failing, pending, passing, scope }` names. With
 * `requireGreen` every check counts (`scope: all`), otherwise only the
 * required ones (`scope: required`). Required checks that have not reported
 * yet are pending. A skipped check counts as passing.
 */
export function classifyChecks(
  all = [],
  required = null,
  { requireGreen = true } = {}
) {
  const requiredNames = new Set((required ?? []).map((c) => c.name));
  const scope = requireGreen
    ? all
    : all.filter((c) => requiredNames.has(c.name));
  const out = {
    failing: [],
    pending: [],
    passing: [],
    scope: requireGreen ? "all" : "required"
  };
  for (const check of scope) {
    const bucket = checkBucket(check);
    if (bucket === "fail" || bucket === "cancel") out.failing.push(check.name);
    else if (bucket === "pending") out.pending.push(check.name);
    else out.passing.push(check.name);
  }
  if (required) {
    const seen = new Set(scope.map((c) => c.name));
    for (const check of required)
      if (!seen.has(check.name)) out.pending.push(check.name);
  }
  return out;
}
