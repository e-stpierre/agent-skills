// Internal review loop of the orchestrated track, read from the run's steps.

import { readStepResults } from "../pr-body.mjs";
import { FINISHED, stepsByRound } from "./state.mjs";

/**
 * Internal review loop, read from the run's steps: review-<N> (esp-review)
 * and fix-review-<N> (esp-fix-review --internal). A round reviews, then fixes
 * the findings. A clean review ends the loop; so does the last round, and a
 * fix round that fixed nothing. Critical findings left after the last fix halt
 * when critical-security is in halt_on.
 */
export function reviewLoop(dir, state, steps = readStepResults(dir)) {
  const max = state.internal_review_rounds;
  if (max === 0)
    return {
      action: "done",
      round: 0,
      max_rounds: 0,
      reason: "internal review disabled"
    };
  const reviews = stepsByRound(steps, "review");
  const fixes = stepsByRound(steps, "fix-review");
  const round = Math.max(0, ...reviews.keys());
  const next = (n) => ({
    action: "review",
    round: n,
    max_rounds: max,
    step: `review-${n}`
  });
  if (round === 0) return next(1);
  const review = reviews.get(round).result;
  if (!FINISHED.has(review.status))
    return {
      action: "stop",
      status: review.status,
      round,
      max_rounds: max,
      reason: `review-${round} ended ${review.status}`
    };
  const findings = review.outputs?.findings ?? 0;
  const critical = review.outputs?.by_severity?.critical ?? 0;
  if (findings === 0)
    return {
      action: "done",
      round,
      max_rounds: max,
      remaining: 0,
      reason: `review-${round} is clean`
    };
  const fix = fixes.get(round)?.result;
  if (!fix)
    return {
      action: "fix",
      round,
      max_rounds: max,
      step: `fix-review-${round}`,
      findings,
      findings_path: review.outputs?.findings_path ?? null
    };
  if (!FINISHED.has(fix.status))
    return {
      action: "stop",
      status: fix.status,
      round,
      max_rounds: max,
      reason: `fix-review-${round} ended ${fix.status}`
    };
  const remaining = fix.outputs?.remaining ?? 0;
  const fixed = fix.outputs?.fixed ?? 0;
  if (round < max && fixed > 0) return next(round + 1);
  if (
    critical > 0 &&
    remaining > 0 &&
    state.halt_on.includes("critical-security")
  )
    return {
      action: "halt",
      key: "critical-security",
      round,
      max_rounds: max,
      remaining,
      reason: `${critical} critical finding(s) in review-${round}, ${remaining} item(s) left after the fix`
    };
  const why =
    fixed === 0
      ? "the fix round fixed nothing"
      : `${max} round${max === 1 ? "" : "s"} used`;
  return {
    action: "done",
    round,
    max_rounds: max,
    remaining,
    exhausted: round >= max,
    reason: `${why}; ${remaining} item(s) left`
  };
}
