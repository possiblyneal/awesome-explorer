// Judges a repository from its metrics: one label answering "should I look at
// this?" and a 0–100 score to rank within a label. The first matching label
// wins, so a young repository gaining stars fast reads as rising even when it
// is also active.
//
//   dead    archived, or no commit for over a year
//   rising  commit within 90 days, under two years old, and gaining stars fast
//   mature  three years old, 1000+ stars, commit within 180 days, ≤25% of issues open
//   active  commit within 90 days, and 5+ commits in that window or issues
//           closed in a median of a week or less
//   stale   everything else: alive, but neither busy nor established

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
  const fixesFast =
    m.medianIssueCloseDays !== null && m.medianIssueCloseDays <= 7;
  const momentum = m.stars30d / Math.max(m.stars, 1);

  const facts: string[] = [];
  facts.push(
    Number.isFinite(idleDays)
      ? `last commit ${Math.floor(idleDays)} days ago`
      : "no commits",
  );
  facts.push(`${m.commits90d} commits in 90 days`);
  if (m.medianIssueCloseDays !== null)
    facts.push(`issues closed in a median of ${m.medianIssueCloseDays} days`);
  if (m.issueBacklog !== null)
    facts.push(`${percent(m.issueBacklog)} of issues still open`);
  if (m.stars30d > 0) facts.push(`+${m.stars30d} stars in 30 days`);

  let label: HealthLabel;
  let why: string;
  if (m.archived) {
    [label, why] = ["dead", "archived by its owners"];
  } else if (idleDays > 365) {
    [label, why] = ["dead", "no commit in over a year"];
  } else if (
    idleDays <= 90 &&
    ageDays < 730 &&
    (m.stars30d >= 50 || (momentum >= 0.05 && m.stars30d >= 10))
  ) {
    [label, why] = [
      "rising",
      `young and gaining stars fast (${percent(momentum)} of its stars this month)`,
    ];
  } else if (
    ageDays >= 1095 &&
    m.stars >= 1000 &&
    idleDays <= 180 &&
    (m.issueBacklog ?? 0) <= 0.25
  ) {
    [label, why] = [
      "mature",
      "established, still maintained, and keeping its issue backlog small",
    ];
  } else if (idleDays <= 90 && (m.commits90d >= 5 || fixesFast)) {
    [label, why] = [
      "active",
      m.commits90d >= 5
        ? "under steady development"
        : "fixing issues fast while development is light",
    ];
  } else {
    [label, why] = ["stale", "maintained only occasionally"];
  }

  const score = m.archived
    ? 0
    : 30 * clamp(1 - idleDays / 365) +
      20 *
        (m.medianIssueCloseDays === null
          ? 0.5
          : clamp(1 - m.medianIssueCloseDays / 60)) +
      15 * (1 - (m.issueBacklog ?? 0)) +
      10 * (1 - (m.pullRequestBacklog ?? 0)) +
      15 * clamp(Math.log10(1 + m.stars30d) / 2) +
      10 * clamp(Math.log10(1 + m.stars) / 5);

  return { label, score: Math.round(score), reasons: [why, ...facts] };
}
