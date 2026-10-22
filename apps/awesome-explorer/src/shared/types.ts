// Shapes the server sends and the UI reads. Repository names are spelled
// `owner/name`; lookups compare them lowercased, since GitHub ignores case.

export type HealthLabel = "mature" | "rising" | "active" | "stale" | "dead";

export interface RepoMetrics {
  repo: string;
  description: string | null;
  url: string;
  archived: boolean;
  createdAt: string;
  lastCommitAt: string | null;
  commits90d: number;
  stars: number;
  /** Stars gained in the last 30 days. */
  stars30d: number;
  language: string | null;
  issuesEnabled: boolean;
  openIssues: number;
  closedIssues: number;
  openPullRequests: number;
  mergedPullRequests: number;
  /** Share of all issues ever opened that are still open; null with issues off or none filed. */
  issueBacklog: number | null;
  /** Share of open and merged pull requests still open; null when there has been none. */
  pullRequestBacklog: number | null;
  /** Median days from opening to closing, over the 20 most recently updated closed issues. */
  medianIssueCloseDays: number | null;
}

export interface Health {
  label: HealthLabel;
  /** 0–100; higher is healthier. */
  score: number;
  reasons: string[];
}

/** One repository link found in an awesome list's README. */
export interface ListEntry {
  repo: string;
  name: string;
  section: string;
  description: string;
}

export interface ExploredEntry extends ListEntry {
  metrics?: RepoMetrics;
  health?: Health;
  /** Why no metrics are shown: GitHub has no such repository, or fetching it failed. */
  unavailable?: string;
}

export interface ListView {
  /** The list's `owner/name`, or `STARS_LIST` for the operator's stars. */
  repo: string;
  fetchedAt: string;
  entries: ExploredEntry[];
  /** Entries whose metrics are still being fetched or refreshed. */
  pending: number;
  error?: string;
}

export interface DiscoveredList {
  repo: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  topics: string[];
  /** Whether sindresorhus/awesome already links to it. */
  inIndex: boolean;
}

export type TrendingPeriod = "daily" | "weekly" | "monthly";

export interface TrendingRepo {
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  /** Stars gained in each period the repository trends in. */
  gained: Partial<Record<TrendingPeriod, number>>;
  /** The best of those gains per day; trending is ranked by it. */
  starsPerDay: number;
}
