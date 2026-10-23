// How a repository's maintainers keep up with what people send them, from one
// GraphQL query per repository: GitHub refuses a batch of these searches for
// exceeding its resource budget. Search does not follow a renamed repository,
// so callers pass the canonical `nameWithOwner` (see docs/LESSONS.md).
//
// An issue or pull request is handled when it was merged or a person closed
// it; one a bot closed (stale sweeps) counts as unhandled, as does one still
// open. The window is items opened in the last year but not the last two
// weeks, so new ones have had a chance to be handled. Search counts cover the
// whole window; who closed an item and when it was answered come only from the
// newest SAMPLE_SIZE items in it, so shares of a busier repository are
// estimated from that sample.

import { GitHubError, type GitHub } from "./github.ts";

const DAY = 86_400_000;
export const SAMPLE_SIZE = 100;
/** Fewer sampled items than this leave a median or share unknown. */
const MIN_SAMPLE = 5;
const MAINTAINERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

interface RawItem {
  __typename: "Issue" | "PullRequest";
  createdAt: string;
  closedAt: string | null;
  mergedAt?: string | null;
  authorAssociation: string;
  timelineItems: { nodes: ({ actor: { __typename: string } | null } | null)[] };
  comments: { nodes: ({ authorAssociation: string } | null)[] };
}

interface RawCommit {
  author: { email: string | null; user: { login: string } | null } | null;
}

export interface RawActivity {
  recent: { issueCount: number; nodes: (RawItem | null)[] };
  recentOpen: { issueCount: number };
  oldOpen: { issueCount: number };
  repository: {
    defaultBranchRef: {
      target: { history?: { nodes: (RawCommit | null)[] } } | null;
    } | null;
  } | null;
}

export interface Activity {
  /** Share of the window's issues and pull requests not handled. */
  backlog: number | null;
  /** Median days to handle, counting an unhandled item at its age so far. */
  medianHandleDays: number | null;
  /** Share of outside contributors' issues with no maintainer reply and not handled. */
  unansweredShare: number | null;
  medianMergeDays: number | null;
  /** Share of open issues and pull requests opened over a year ago. */
  oldOpenShare: number | null;
  /** Distinct commit authors in 90 days, among the newest 100 commits. */
  committers90d: number;
}

const ITEM = `createdAt closedAt authorAssociation
  timelineItems(itemTypes: CLOSED_EVENT, last: 1) { nodes { ... on ClosedEvent { actor { __typename } } } }
  comments(first: 10) { nodes { authorAssociation } }`;

const QUERY = `
query($recent: String!, $recentOpen: String!, $oldOpen: String!, $owner: String!, $name: String!, $since: GitTimestamp!) {
  recent: search(type: ISSUE, query: $recent, first: ${SAMPLE_SIZE}) {
    issueCount
    nodes {
      __typename
      ... on Issue { ${ITEM} }
      ... on PullRequest { mergedAt ${ITEM} }
    }
  }
  recentOpen: search(type: ISSUE, query: $recentOpen, first: 0) { issueCount }
  oldOpen: search(type: ISSUE, query: $oldOpen, first: 0) { issueCount }
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit { history(since: $since, first: 100) { nodes { author { email user { login } } } } } } }
  }
}`;

function date(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export async function fetchActivity(
  github: Pick<GitHub, "graphql">,
  repo: string,
  now: Date,
): Promise<RawActivity> {
  const [owner, name] = repo.split("/");
  const yearAgo = date(now.getTime() - 365 * DAY);
  const window = `repo:${repo} created:${yearAgo}..${date(now.getTime() - 14 * DAY)}`;
  const response = await github.graphql<RawActivity>(QUERY, {
    recent: `${window} sort:created-desc`,
    recentOpen: `${window} is:open`,
    oldOpen: `repo:${repo} is:open created:<${yearAgo}`,
    owner,
    name,
    since: new Date(now.getTime() - 90 * DAY).toISOString(),
  });
  const error = response.errors[0];
  if (error || !response.data)
    throw new GitHubError(
      200,
      `GitHub GraphQL: ${error?.message ?? "no data"}`,
    );
  return response.data;
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

function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** When a person merged or closed the item, or null while it is unhandled. */
function handledAt(item: RawItem): string | null {
  if (item.mergedAt) return item.mergedAt;
  const closer = item.timelineItems.nodes[0]?.actor;
  return item.closedAt && closer?.__typename !== "Bot" ? item.closedAt : null;
}

const days = (start: string, end: number) => (end - Date.parse(start)) / DAY;

export function summarizeActivity(
  raw: RawActivity,
  openItems: number,
  now: Date,
): Activity {
  const sample = raw.recent.nodes.filter((item) => item !== null);
  const opened = raw.recent.issueCount;
  const open = raw.recentOpen.issueCount;
  const closed = sample.filter((item) => item.closedAt);
  const botClosed = closed.filter((item) => !handledAt(item)).length;
  const botShare = share(botClosed, closed.length) ?? 0;

  const handleDays = sample.map((item) => {
    const handled = handledAt(item);
    return days(item.createdAt, handled ? Date.parse(handled) : now.getTime());
  });
  const outsideIssues = sample.filter(
    (item) =>
      item.__typename === "Issue" && !MAINTAINERS.has(item.authorAssociation),
  );
  const unanswered = outsideIssues.filter(
    (item) =>
      !handledAt(item) &&
      !item.comments.nodes.some(
        (comment) => comment && MAINTAINERS.has(comment.authorAssociation),
      ),
  ).length;
  const mergeDays = sample.flatMap((item) =>
    item.mergedAt ? [days(item.createdAt, Date.parse(item.mergedAt))] : [],
  );
  const authors = (
    raw.repository?.defaultBranchRef?.target?.history?.nodes ?? []
  ).flatMap((commit) => {
    const author = commit?.author;
    const id = author?.user?.login ?? author?.email;
    return id ? [id.toLowerCase()] : [];
  });

  return {
    backlog: share(open + (opened - open) * botShare, opened),
    medianHandleDays:
      handleDays.length >= MIN_SAMPLE ? median(handleDays) : null,
    unansweredShare:
      outsideIssues.length >= MIN_SAMPLE
        ? share(unanswered, outsideIssues.length)
        : null,
    medianMergeDays: mergeDays.length >= MIN_SAMPLE ? median(mergeDays) : null,
    oldOpenShare: share(raw.oldOpen.issueCount, openItems),
    committers90d: new Set(authors).size,
  };
}
