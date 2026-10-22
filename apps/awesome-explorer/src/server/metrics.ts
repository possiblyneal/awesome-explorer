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
// Five weeks of history always cover the last 30 days.
const HISTORY_WEEKS = 5;

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
  homepageUrl: string | null;
  isArchived: boolean;
  isFork: boolean;
  createdAt: string;
  stargazerCount: number;
  forkCount: number;
  hasIssuesEnabled: boolean;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null } | null;
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
  recentMergedPullRequests: {
    nodes: ({ createdAt: string; mergedAt: string | null } | null)[];
  };
  latestRelease: { publishedAt: string | null } | null;
}

const FRAGMENT = `
fragment Metrics on Repository {
  nameWithOwner description url homepageUrl isArchived isFork createdAt
  stargazerCount forkCount hasIssuesEnabled
  primaryLanguage { name }
  licenseInfo { spdxId }
  defaultBranchRef { target { ... on Commit { committedDate history(since: $since) { totalCount } } } }
  openIssues: issues(states: OPEN) { totalCount }
  closedIssues: issues(states: CLOSED) { totalCount }
  recentClosedIssues: issues(states: CLOSED, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes { createdAt closedAt }
  }
  openPullRequests: pullRequests(states: OPEN) { totalCount }
  mergedPullRequests: pullRequests(states: MERGED) { totalCount }
  recentMergedPullRequests: pullRequests(states: MERGED, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes { createdAt mergedAt }
  }
  latestRelease { publishedAt }
}`;

/** One aliased `repository` lookup per name: r0, r1, … in the order given. */
export function buildQuery(repos: string[]): string {
  const lookups = repos.map((repo, index) => {
    const [owner, name] = repo.split("/");
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...Metrics }`;
  });
  return `query($since: GitTimestamp!) {\n${lookups.join("\n")}\n}\n${FRAGMENT}`;
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
    homepage: raw.homepageUrl || null,
    archived: raw.isArchived,
    fork: raw.isFork,
    createdAt: raw.createdAt,
    lastCommitAt: head?.committedDate ?? null,
    commits90d: head?.history?.totalCount ?? 0,
    stars: raw.stargazerCount,
    stars30d: starsLast30Days(history, now),
    forks: raw.forkCount,
    language: raw.primaryLanguage?.name ?? null,
    license: raw.licenseInfo?.spdxId ?? null,
    issuesEnabled: raw.hasIssuesEnabled,
    openIssues: raw.openIssues.totalCount,
    closedIssues: raw.closedIssues.totalCount,
    openPullRequests: raw.openPullRequests.totalCount,
    mergedPullRequests: raw.mergedPullRequests.totalCount,
    medianIssueCloseDays: median(
      raw.recentClosedIssues.nodes.flatMap((issue) =>
        issue ? daysBetween(issue.createdAt, issue.closedAt) : [],
      ),
    ),
    medianPullRequestMergeDays: median(
      raw.recentMergedPullRequests.nodes.flatMap((pr) =>
        pr ? daysBetween(pr.createdAt, pr.mergedAt) : [],
      ),
    ),
    latestReleaseAt: raw.latestRelease?.publishedAt ?? null,
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
 * a request GitHub refuses is narrowed to the repository causing it.
 */
export async function fetchMetrics(
  github: Pick<GitHub, "graphql" | "starHistory">,
  repos: string[],
  now: Date,
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
      for (const [repo, result] of await fetchMetrics(github, half, now))
        results.set(repo, result);
    }
    return results;
  }
  await Promise.all(
    repos.map(async (repo, index) =>
      results.set(repo, await toResult(github, data?.[`r${index}`], now)),
    ),
  );
  return results;
}
