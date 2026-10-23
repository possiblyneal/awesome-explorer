// Shapes the server sends and the UI reads. Repository names are spelled
// `owner/name`; lookups compare them lowercased, since GitHub ignores case.

export type HealthLabel = "mature" | "rising" | "active" | "stale" | "dead";

export interface RepoMetrics {
  repo: string;
  description: string | null;
  url: string;
  archived: boolean;
  fork: boolean;
  createdAt: string;
  lastCommitAt: string | null;
  commits90d: number;
  /** Distinct commit authors in 90 days, among the newest 100 commits. */
  committers90d: number;
  stars: number;
  /** Stars gained in the last 30 days. */
  stars30d: number;
  language: string | null;
  /** SPDX identifier; null when there is none or GitHub cannot tell. */
  license: string | null;
  lastReleaseAt: string | null;
  issuesEnabled: boolean;
  openIssues: number;
  openPullRequests: number;
  /** Share of open issues and pull requests opened over a year ago; null with none open. */
  oldOpenShare: number | null;
  // Over issues and pull requests opened 2 weeks to a year ago; see GLOSSARY.md
  // for Handled. Null when there are too few to say.
  /** Share not handled. */
  backlog: number | null;
  /** Median days to handle, an unhandled one counted at its age so far. */
  medianHandleDays: number | null;
  /** Share of outside contributors' issues with no maintainer reply and not handled. */
  unansweredShare: number | null;
  medianMergeDays: number | null;
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
  /** Star lists holding the repository; only starred entries have them. */
  lists?: string[];
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
  /** The language's swatch color on the trending page; null without a language. */
  languageColor: string | null;
  stars: number;
  /** Stars gained in each period the repository trends in. */
  gained: Partial<Record<TrendingPeriod, number>>;
  /**
   * Stars per day over the last 7 whole days, from the star history; without
   * one, `gained` per day over the week, else the month, else the best period.
   * Trending is ranked by it.
   */
  starsPerDay: number;
  /** The uploaded social preview's URL; null when the repository has none. */
  image: string | null;
}
