// Fetches the activity, backlog, and popularity numbers behind a health
// assessment, many repositories per GraphQL query. GitHub answers a missing
// repository with a null alias and a NOT_FOUND error. Any other error means
// the data is not to be trusted: a query over GitHub's resource budget still
// returns 200, with RESOURCE_LIMITS_EXCEEDED errors and the fields it gave up
// on nulled. So a batch with such an error, or one that fails outright, is
// split in half until the repository that fails it stands alone. Recent
// stars come from the REST star history and backlog and response numbers from
// `activity.ts`, one request each per repository found, made by
// `completeMetrics` so a caller can finish each repository on its own.

import type { RepoMetrics } from "../shared/types.ts";
import {
  fetchActivity,
  summarizeActivity,
  type RawActivity,
} from "./activity.ts";
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
  isFork: boolean;
  createdAt: string;
  stargazerCount: number;
  hasIssuesEnabled: boolean;
  primaryLanguage: { name: string } | null;
  defaultBranchRef: {
    target: { committedDate?: string; history?: Count } | null;
  } | null;
  latestRelease: { publishedAt: string | null } | null;
  licenseInfo: { spdxId: string | null } | null;
  openIssues: Count;
  openPullRequests: Count;
}

const FRAGMENT = `
fragment Metrics on Repository {
  nameWithOwner description url isArchived isFork createdAt
  stargazerCount hasIssuesEnabled
  primaryLanguage { name }
  latestRelease { publishedAt }
  licenseInfo { spdxId }
  defaultBranchRef { target { ... on Commit { committedDate history(since: $since) { totalCount } } } }
  openIssues: issues(states: OPEN) { totalCount }
  openPullRequests: pullRequests(states: OPEN) { totalCount }
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
  activity: RawActivity,
  now: Date,
): RepoMetrics {
  const head = raw.defaultBranchRef?.target;
  const openIssues = raw.openIssues.totalCount;
  const openPullRequests = raw.openPullRequests.totalCount;
  const license = raw.licenseInfo?.spdxId;
  return {
    repo: raw.nameWithOwner,
    description: raw.description,
    url: raw.url,
    archived: raw.isArchived,
    fork: raw.isFork,
    createdAt: raw.createdAt,
    lastCommitAt: head?.committedDate ?? null,
    commits90d: head?.history?.totalCount ?? 0,
    stars: raw.stargazerCount,
    stars30d: starsLast30Days(history, now),
    language: raw.primaryLanguage?.name ?? null,
    issuesEnabled: raw.hasIssuesEnabled,
    openIssues,
    openPullRequests,
    lastReleaseAt: raw.latestRelease?.publishedAt ?? null,
    // GitHub answers NOASSERTION for a license file it cannot identify.
    license: license && license !== "NOASSERTION" ? license : null,
    ...summarizeActivity(activity, openIssues + openPullRequests, now),
  };
}

/** A repository's batch lookup: its raw fields, or the final result when there are none. */
export type Lookup =
  | { status: "found"; raw: RawRepository }
  | Exclude<MetricsResult, { status: "found" }>;

// GitHub nulls a node it will not show (a deleted author, a hidden issue)
// rather than failing the query, so data of an unexpected shape fails only the
// repository it belongs to instead of stalling every batch behind it. So does a
// star history or activity query GitHub refuses.
/** Finishes a looked-up repository with its star history and activity. */
export async function completeMetrics(
  github: Pick<GitHub, "graphql" | "starHistory">,
  lookup: Lookup,
  now: Date,
): Promise<MetricsResult> {
  if (lookup.status !== "found") return lookup;
  const { raw } = lookup;
  let history: StarWeek[];
  let activity: RawActivity;
  try {
    [history, activity] = await Promise.all([
      github.starHistory(raw.nameWithOwner, HISTORY_WEEKS).then((h) => h ?? []),
      fetchActivity(github, raw.nameWithOwner, now),
    ]);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return { status: "failed", reason: error.message };
  }
  try {
    return { status: "found", metrics: toMetrics(raw, history, activity, now) };
  } catch (error) {
    return {
      status: "failed",
      reason: `unexpected data from GitHub: ${(error as Error).message}`,
    };
  }
}

/**
 * Each repository's batch lookup, keyed by the name as given. Rate limits and
 * network failures propagate, since every repository would fail the same way;
 * a request GitHub refuses is narrowed to the repository causing it. A server
 * error that every repository in the batch then fails too is GitHub being
 * down rather than refusing one query, so it propagates as well.
 */
export function lookUpRepositories(
  github: Pick<GitHub, "graphql">,
  repos: string[],
  now: Date,
): Promise<Map<string, Lookup>> {
  return lookUpSplitting(github, repos, now, true);
}

async function lookUpSplitting(
  github: Pick<GitHub, "graphql">,
  repos: string[],
  now: Date,
  whole: boolean,
): Promise<Map<string, Lookup>> {
  const results = new Map<string, Lookup>();
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
      for (const [repo, result] of await lookUpSplitting(
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
  repos.forEach((repo, index) => {
    const raw = data?.[`r${index}`];
    results.set(repo, raw ? { status: "found", raw } : { status: "missing" });
  });
  return results;
}
