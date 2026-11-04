// Judges a repository from its metrics: one label answering "should I look at
// this?" and a 0–100 score to rank within a label. The first matching label
// wins, so a repository gaining stars fast reads as rising even when it is
// also mature.
//
//   dead    archived, or no commit for over two years
//   rising  commit within 90 days, 20+ stars a day over 30 days, and 5%+
//           more stars in that time, at any age; the floor alone would call
//           every big repository rising, the share alone every tiny one
//   mature  a year old, commit within a year, backlog ≤10%; stars, commit
//           pace, and open issue and pull request counts do not count
//   stale   no commit for over a year
//   active  everything else

import type { Health, HealthLabel, RepoMetrics } from "../shared/types.ts";

const DAY = 86_400_000;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function assessHealth(m: RepoMetrics, now: Date): Health {
  const ageDays = (now.getTime() - Date.parse(m.createdAt)) / DAY;
  const idleDays = m.lastCommitAt
    ? (now.getTime() - Date.parse(m.lastCommitAt)) / DAY
    : Infinity;
  const momentum = m.stars30d / Math.max(m.stars, 1);

  const facts: string[] = [];
  facts.push(
    Number.isFinite(idleDays)
      ? `last commit ${Math.floor(idleDays)} days ago`
      : "no commits",
  );
  facts.push(`${m.commits90d} commits in 90 days`);
  if (m.medianHandleDays !== null)
    facts.push(
      `issues and pull requests handled in a median of ${m.medianHandleDays} days`,
    );
  if (m.backlog !== null)
    facts.push(`${percent(m.backlog)} of the last year's left unhandled`);
  if (m.stars30d > 0) facts.push(`+${m.stars30d} stars in 30 days`);

  let label: HealthLabel;
  let why: string;
  if (m.archived) {
    [label, why] = ["dead", "archived by its owners"];
  } else if (idleDays > 730) {
    [label, why] = ["dead", "no commit in over two years"];
  } else if (idleDays <= 90 && m.stars30d >= 600 && momentum >= 0.05) {
    [label, why] = [
      "rising",
      `gaining stars fast (${percent(momentum)} of its stars this month)`,
    ];
  } else if (ageDays >= 365 && idleDays <= 365 && (m.backlog ?? 0) <= 0.1) {
    [label, why] = ["mature", "keeping up with what is reported"];
  } else if (idleDays > 365) {
    [label, why] = ["stale", "no commit in over a year"];
  } else {
    [label, why] = ["active", "under development"];
  }

  const score = m.archived
    ? 0
    : 30 * clamp(1 - idleDays / 365) +
      20 *
        (m.medianHandleDays === null
          ? 0.5
          : clamp(1 - m.medianHandleDays / 60)) +
      25 * (1 - (m.backlog ?? 0)) +
      15 * clamp(Math.log10(1 + m.stars30d) / 2) +
      10 * clamp(Math.log10(1 + m.stars) / 5);

  return { label, score: Math.round(score), reasons: [why, ...facts] };
}
