// Fetches the activity, backlog, and popularity numbers behind a health
// assessment, many repositories per GraphQL query. GitHub answers a missing
// repository with a null alias and a NOT_FOUND error. Any other error means
// the data is not to be trusted: a query over GitHub's resource budget still
// returns 200, with RESOURCE_LIMITS_EXCEEDED errors and the fields it gave up
// on nulled. So a batch with such an error, or one that fails outright, is
// split in half until the repository that fails it stands alone. Recent
// stars come from the REST star history, one request per repository found.

import type { RepoMetrics } from "../shared/types.ts";
import { GitHubError, type GitHub, type StarWeek } from "./github.ts";

// GitHub spends about 0.4s per repository on this query whatever the batch
// size, and refuses a batch of 25 for exceeding its resource budget.
export const BATCH_SIZE = 10;
const DAY = 86_400_000;
// The newest week starts on the latest Sunday, so on a Sunday five weeks reach
// back only 28 days; six always cover the last 30.
const HISTORY_WEEKS = 6;

export type MetricsResult =
  | { status: "found"; metrics: RepoMetrics }
  | { status: "missing" }
  | { status: "failed"; reason: string };

interface Count {
  totalCount: number;
}

export interface RawRepository {
  nameWithOwner: string;
  description: string | null;
  url: string;
  isArchived: boolean;
  createdAt: string;
  stargazerCount: number;
  hasIssuesEnabled: boolean;
  primaryLanguage: { name: string } | null;
  defaultBranchRef: {
    target: { committedDate?: string; history?: Count } | null;
  } | null;
  openIssues: Count;
  closedIssues: Count;
  recentClosedIssues: {
    nodes: ({ createdAt: string; closedAt: string | null } | null)[];
  };
  openPullRequests: Count;
  mergedPullRequests: Count;
}

const FRAGMENT = `
fragment Metrics on Repository {
  nameWithOwner description url isArchived createdAt
  stargazerCount hasIssuesEnabled
  primaryLanguage { name }
  defaultBranchRef { target { ... on Commit { committedDate history(since: $since) { totalCount } } } }
  openIssues: issues(states: OPEN) { totalCount }
  closedIssues: issues(states: CLOSED) { totalCount }
  recentClosedIssues: issues(states: CLOSED, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes { createdAt closedAt }
  }
  openPullRequests: pullRequests(states: OPEN) { totalCount }
  mergedPullRequests: pullRequests(states: MERGED) { totalCount }
}`;

/** One aliased `repository` lookup per name, selecting `selection`: r0, r1, … in the order given. */
export function repositoryLookups(repos: string[], selection: string): string {
  return repos
    .map((repo, index) => {
      const [owner, name] = repo.split("/");
      return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) ${selection}`;
    })
    .join("\n");
}

export function buildQuery(repos: string[]): string {
  return `query($since: GitTimestamp!) {\n${repositoryLookups(repos, "{ ...Metrics }")}\n}\n${FRAGMENT}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 10) / 10;
}

/** Share of a backlog still open, or null when there has never been one. */
function backlog(open: number, done: number): number | null {
  return open + done === 0 ? null : open / (open + done);
}

function daysBetween(start: string, end: string | null): number[] {
  return end ? [(Date.parse(end) - Date.parse(start)) / DAY] : [];
}

/** Stars gained on the days starting within 30 days before `now`. */
export function starsLast30Days(history: StarWeek[], now: Date): number {
  const monthAgo = now.getTime() - 30 * DAY;
  return history
    .flatMap((week) =>
      week.days.filter((_, day) => week.week * 1000 + day * DAY >= monthAgo),
    )
    .reduce((sum, stars) => sum + stars, 0);
}

/** Stars gained per day over the 7 whole UTC days before `now`'s day. */
export function starsPerDayLastWeek(history: StarWeek[], now: Date): number {
  const today = Math.floor(now.getTime() / DAY) * DAY;
  const weekAgo = today - 7 * DAY;
  const stars = history
    .flatMap((week) =>
      week.days.filter((_, day) => {
        const start = week.week * 1000 + day * DAY;
        return start >= weekAgo && start < today;
      }),
    )
    .reduce((sum, count) => sum + count, 0);
  return stars / 7;
}

export function toMetrics(
  raw: RawRepository,
  history: StarWeek[],
  now: Date,
): RepoMetrics {
  const head = raw.defaultBranchRef?.target;
  return {
    repo: raw.nameWithOwner,
    description: raw.description,
    url: raw.url,
    archived: raw.isArchived,
    createdAt: raw.createdAt,
    lastCommitAt: head?.committedDate ?? null,
    commits90d: head?.history?.totalCount ?? 0,
    stars: raw.stargazerCount,
    stars30d: starsLast30Days(history, now),
    language: raw.primaryLanguage?.name ?? null,
    issuesEnabled: raw.hasIssuesEnabled,
    openIssues: raw.openIssues.totalCount,
    closedIssues: raw.closedIssues.totalCount,
    openPullRequests: raw.openPullRequests.totalCount,
    mergedPullRequests: raw.mergedPullRequests.totalCount,
    issueBacklog: raw.hasIssuesEnabled
      ? backlog(raw.openIssues.totalCount, raw.closedIssues.totalCount)
      : null,
    pullRequestBacklog: backlog(
      raw.openPullRequests.totalCount,
      raw.mergedPullRequests.totalCount,
    ),
    medianIssueCloseDays: median(
      raw.recentClosedIssues.nodes.flatMap((issue) =>
        issue ? daysBetween(issue.createdAt, issue.closedAt) : [],
      ),
    ),
  };
}

// GitHub nulls a node it will not show (a deleted author, a hidden issue)
// rather than failing the query, so data of an unexpected shape fails only the
// repository it belongs to instead of stalling every batch behind it. So does a
// star history GitHub refuses.
async function toResult(
  github: Pick<GitHub, "starHistory">,
  raw: RawRepository | null | undefined,
  now: Date,
): Promise<MetricsResult> {
  if (!raw) return { status: "missing" };
  let history: StarWeek[];
  try {
    history =
      (await github.starHistory(raw.nameWithOwner, HISTORY_WEEKS)) ?? [];
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return { status: "failed", reason: error.message };
  }
  try {
    return { status: "found", metrics: toMetrics(raw, history, now) };
  } catch (error) {
    return {
      status: "failed",
      reason: `unexpected data from GitHub: ${(error as Error).message}`,
    };
  }
}

/**
 * Metrics for each repository, keyed by the name as given. Rate limits and
 * network failures propagate, since every repository would fail the same way;
 * a request GitHub refuses is narrowed to the repository causing it. A server
 * error that every repository in the batch then fails too is GitHub being
 * down rather than refusing one query, so it propagates as well.
 */
export async function fetchMetrics(
  github: Pick<GitHub, "graphql" | "starHistory">,
  repos: string[],
  now: Date,
): Promise<Map<string, MetricsResult>> {
  return fetchSplitting(github, repos, now, true);
}

async function fetchSplitting(
  github: Pick<GitHub, "graphql" | "starHistory">,
  repos: string[],
  now: Date,
  whole: boolean,
): Promise<Map<string, MetricsResult>> {
  const results = new Map<string, MetricsResult>();
  const since = new Date(now.getTime() - 90 * DAY).toISOString();
  let data: Record<string, RawRepository | null> | null;
  try {
    const response = await github.graphql<Record<string, RawRepository | null>>(
      buildQuery(repos),
      { since },
    );
    const refusal = response.errors.find((error) => error.type !== "NOT_FOUND");
    if (refusal)
      throw new GitHubError(200, `GitHub GraphQL: ${refusal.message}`);
    data = response.data;
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    if (repos.length === 1) {
      results.set(repos[0]!, { status: "failed", reason: error.message });
      return results;
    }
    const middle = Math.ceil(repos.length / 2);
    for (const half of [repos.slice(0, middle), repos.slice(middle)]) {
      for (const [repo, result] of await fetchSplitting(
        github,
        half,
        now,
        false,
      ))
        results.set(repo, result);
    }
    const outage =
      whole &&
      error.status >= 500 &&
      [...results.values()].every((result) => result.status === "failed");
    if (outage) throw error;
    return results;
  }
  await Promise.all(
    repos.map(async (repo, index) =>
      results.set(repo, await toResult(github, data?.[`r${index}`], now)),
    ),
  );
  return results;
}
