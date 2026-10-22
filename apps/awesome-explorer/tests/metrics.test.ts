import { describe, expect, it } from "vitest";
import {
  GitHubError,
  type GraphQLResponse,
  type StarWeek,
} from "../src/server/github.ts";
import {
  buildQuery,
  fetchMetrics,
  toMetrics,
  starsLast30Days,
  type RawRepository,
} from "../src/server/metrics.ts";

const NOW = new Date("2026-10-01T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

function raw(name: string): RawRepository {
  return {
    nameWithOwner: name,
    description: "A thing",
    url: `https://github.com/${name}`,
    isArchived: false,
    createdAt: daysAgo(1000),
    stargazerCount: 1234,
    hasIssuesEnabled: true,
    primaryLanguage: { name: "Go" },
    defaultBranchRef: {
      target: { committedDate: daysAgo(2), history: { totalCount: 42 } },
    },
    openIssues: { totalCount: 10 },
    closedIssues: { totalCount: 90 },
    recentClosedIssues: {
      nodes: [
        { createdAt: daysAgo(10), closedAt: daysAgo(9) },
        { createdAt: daysAgo(10), closedAt: daysAgo(7) },
        { createdAt: daysAgo(10), closedAt: daysAgo(0) },
      ],
    },
    openPullRequests: { totalCount: 3 },
    mergedPullRequests: { totalCount: 70 },
  };
}

// NOW is a Thursday; its week began on Sunday 2026-09-27.
const HISTORY: StarWeek[] = [
  {
    week: Date.parse("2026-09-27") / 1000,
    total: 5,
    days: [1, 1, 1, 1, 1, 0, 0],
  },
  {
    week: Date.parse("2026-08-30") / 1000,
    total: 70,
    days: [10, 10, 10, 10, 10, 10, 10],
  },
];

describe("starsLast30Days", () => {
  it("counts only the days starting within the last 30", () => {
    // 2026-09-01 is 30 days before NOW, the Tuesday of the older week.
    expect(starsLast30Days(HISTORY, NOW)).toBe(5 + 50);
  });

  it("covers the last 30 days on a Sunday, when the newest week is a day old", () => {
    const sunday = new Date("2026-10-04T12:00:00Z");
    const weeks = [
      "2026-10-04",
      "2026-09-27",
      "2026-09-20",
      "2026-09-13",
      "2026-09-06",
      "2026-08-30",
    ];
    const history = weeks.map((week, index) => ({
      week: Date.parse(week) / 1000,
      total: index === 0 ? 1 : 7,
      days: index === 0 ? [1, 0, 0, 0, 0, 0, 0] : [1, 1, 1, 1, 1, 1, 1],
    }));
    // 30 days back from Sunday noon reaches 2026-09-04 noon, so the days from
    // 09-05 through 10-04 count; five weeks would stop at 09-06.
    expect(starsLast30Days(history, sunday)).toBe(30);
  });
});

describe("toMetrics", () => {
  it("maps GitHub's fields and derives medians and recent stars", () => {
    expect(toMetrics(raw("acme/thing"), HISTORY, NOW)).toMatchObject({
      repo: "acme/thing",
      lastCommitAt: daysAgo(2),
      commits90d: 42,
      stars: 1234,
      stars30d: 55,
      language: "Go",
      openIssues: 10,
      closedIssues: 90,
      issueBacklog: 0.1,
      medianIssueCloseDays: 3,
    });
  });

  it("leaves the issue backlog empty when issues are off or never opened", () => {
    expect(
      toMetrics({ ...raw("acme/off"), hasIssuesEnabled: false }, [], NOW)
        .issueBacklog,
    ).toBeNull();
    expect(
      toMetrics(
        {
          ...raw("acme/new"),
          openPullRequests: { totalCount: 0 },
          mergedPullRequests: { totalCount: 0 },
        },
        [],
        NOW,
      ).pullRequestBacklog,
    ).toBeNull();
  });

  it("skips nodes GitHub nulls", () => {
    const repo = raw("acme/thing");
    repo.recentClosedIssues.nodes.push(null);
    expect(toMetrics(repo, [], NOW)).toMatchObject({
      medianIssueCloseDays: 3,
    });
  });

  it("treats an empty repository as having no commits", () => {
    expect(
      toMetrics({ ...raw("acme/empty"), defaultBranchRef: null }, [], NOW),
    ).toMatchObject({
      lastCommitAt: null,
      commits90d: 0,
    });
  });
});

describe("buildQuery", () => {
  it("aliases one lookup per repository", () => {
    const query = buildQuery(["a/b", "c/d"]);
    expect(query).toContain('r0: repository(owner: "a", name: "b")');
    expect(query).toContain('r1: repository(owner: "c", name: "d")');
  });
});

describe("fetchMetrics", () => {
  it("records a null alias as missing", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: async <T>() =>
        ({
          data: { r0: raw("a/one"), r1: null },
          errors: [],
        }) as unknown as GraphQLResponse<T>,
    };
    const results = await fetchMetrics(github, ["a/one", "a/gone"], NOW);
    expect(results.get("a/one")?.status).toBe("found");
    expect(results.get("a/gone")).toEqual({ status: "missing" });
  });

  it("splits a batch GitHub answered only in part", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: async <T>(query: string) => {
        const partial = query.includes('"heavy"');
        return {
          data: { r0: partial ? null : raw("a/light"), r1: null },
          errors: partial
            ? [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "too much" }]
            : [{ type: "NOT_FOUND", message: "gone" }],
        } as unknown as GraphQLResponse<T>;
      },
    };
    const results = await fetchMetrics(github, ["a/light", "a/heavy"], NOW);
    expect(results.get("a/light")?.status).toBe("found");
    expect(results.get("a/heavy")).toEqual({
      status: "failed",
      reason: "GitHub GraphQL: too much",
    });
  });

  it("splits a refused batch until the failing repository stands alone", async () => {
    let calls = 0;
    const github = {
      starHistory: async () => HISTORY,
      graphql: async <T>(query: string) => {
        calls++;
        if (query.includes('"bad"')) throw new GitHubError(502, "timeout");
        const count = query.match(/r\d+:/g)!.length;
        const data = Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`r${i}`, raw(`a/${i}`)]),
        );
        return { data, errors: [] } as unknown as GraphQLResponse<T>;
      },
    };
    const results = await fetchMetrics(
      github,
      ["a/x", "a/bad", "a/y", "a/z"],
      NOW,
    );
    expect(results.get("a/bad")).toEqual({
      status: "failed",
      reason: "timeout",
    });
    expect(
      [...results.values()].filter((r) => r.status === "found"),
    ).toHaveLength(3);
    expect(calls).toBe(5);
  });

  it("propagates an outage that fails every repository in the batch", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: async () => {
        throw new GitHubError(503, "unavailable");
      },
    };
    await expect(
      fetchMetrics(github, ["a/one", "a/two", "a/three"], NOW),
    ).rejects.toThrow("unavailable");
  });

  it("fails only the repository whose star history GitHub refuses", async () => {
    const github = {
      graphql: async <T>() =>
        ({
          data: { r0: raw("a/one"), r1: raw("a/two") },
          errors: [],
        }) as unknown as GraphQLResponse<T>,
      starHistory: async (repo: string) => {
        if (repo === "a/two") throw new GitHubError(500, "boom");
        return HISTORY;
      },
    };
    const results = await fetchMetrics(github, ["a/one", "a/two"], NOW);
    expect(results.get("a/one")?.status).toBe("found");
    expect(results.get("a/two")).toEqual({ status: "failed", reason: "boom" });
  });
});
