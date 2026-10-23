import { describe, expect, it } from "vitest";
import {
  GitHubError,
  type GraphQLResponse,
  type StarWeek,
} from "../src/server/github.ts";
import type { RawActivity } from "../src/server/activity.ts";
import {
  buildQuery,
  completeMetrics,
  lookUpRepositories,
  toMetrics,
  starsLast30Days,
  starsPerDayLastWeek,
  type MetricsResult,
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
    isFork: false,
    createdAt: daysAgo(1000),
    stargazerCount: 1234,
    hasIssuesEnabled: true,
    primaryLanguage: { name: "Go" },
    defaultBranchRef: {
      target: { committedDate: daysAgo(2), history: { totalCount: 42 } },
    },
    latestRelease: { publishedAt: daysAgo(20) },
    licenseInfo: { spdxId: "MIT" },
    openIssues: { totalCount: 10 },
    openPullRequests: { totalCount: 2 },
  };
}

const ACTIVITY: RawActivity = {
  recent: { issueCount: 0, nodes: [] },
  recentOpen: { issueCount: 0 },
  oldOpen: { issueCount: 3 },
  repository: null,
};

/** Answers activity queries with ACTIVITY and the rest with `metrics`. */
function graphql(
  metrics: (query: string) => Promise<unknown>,
): <T>(query: string) => Promise<GraphQLResponse<T>> {
  return async <T>(query: string) =>
    (query.includes("recentOpen")
      ? { data: ACTIVITY, errors: [] }
      : await metrics(query)) as GraphQLResponse<T>;
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

describe("starsPerDayLastWeek", () => {
  it("averages the 7 whole days before today, across the week boundary", () => {
    // A Wednesday afternoon; its week began on Sunday 2026-10-18.
    const wednesday = new Date("2026-10-21T15:00:00Z");
    const history: StarWeek[] = [
      {
        week: Date.parse("2026-10-18") / 1000,
        total: 1300,
        days: [100, 100, 100, 1000, 0, 0, 0],
      },
      {
        week: Date.parse("2026-10-11") / 1000,
        total: 28,
        days: [1, 2, 3, 4, 5, 6, 7],
      },
    ];
    // Wednesday 10-14 through Tuesday 10-20; today's partial 1000 is left out.
    expect(starsPerDayLastWeek(history, wednesday)).toBe(
      (4 + 5 + 6 + 7 + 300) / 7,
    );
  });
});

describe("toMetrics", () => {
  it("maps GitHub's fields and derives activity and recent stars", () => {
    expect(toMetrics(raw("acme/thing"), HISTORY, ACTIVITY, NOW)).toMatchObject({
      repo: "acme/thing",
      lastCommitAt: daysAgo(2),
      commits90d: 42,
      stars: 1234,
      stars30d: 55,
      language: "Go",
      license: "MIT",
      lastReleaseAt: daysAgo(20),
      fork: false,
      openIssues: 10,
      oldOpenShare: 0.25,
      backlog: null,
    });
  });

  it("leaves the license empty when GitHub cannot identify it", () => {
    expect(
      toMetrics(
        { ...raw("acme/odd"), licenseInfo: { spdxId: "NOASSERTION" } },
        [],
        ACTIVITY,
        NOW,
      ).license,
    ).toBeNull();
  });

  it("treats an empty repository as having no commits", () => {
    expect(
      toMetrics(
        { ...raw("acme/empty"), defaultBranchRef: null },
        [],
        ACTIVITY,
        NOW,
      ),
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

/** Both stages, as the explorer runs them for each repository. */
async function fetchMetrics(
  github: Parameters<typeof completeMetrics>[0],
  repos: string[],
  now: Date,
): Promise<Map<string, MetricsResult>> {
  const lookups = await lookUpRepositories(github, repos, now);
  const results = new Map<string, MetricsResult>();
  for (const [repo, lookup] of lookups)
    results.set(repo, await completeMetrics(github, lookup, now));
  return results;
}

describe("lookUpRepositories and completeMetrics", () => {
  it("records a null alias as missing", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: graphql(async () => ({
        data: { r0: raw("a/one"), r1: null },
        errors: [],
      })),
    };
    const results = await fetchMetrics(github, ["a/one", "a/gone"], NOW);
    expect(results.get("a/one")?.status).toBe("found");
    expect(results.get("a/gone")).toEqual({ status: "missing" });
  });

  it("splits a batch GitHub answered only in part", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: graphql(async (query) => {
        const partial = query.includes('"heavy"');
        return {
          data: { r0: partial ? null : raw("a/light"), r1: null },
          errors: partial
            ? [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "too much" }]
            : [{ type: "NOT_FOUND", message: "gone" }],
        };
      }),
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
      graphql: graphql(async (query) => {
        calls++;
        if (query.includes('"bad"')) throw new GitHubError(502, "timeout");
        const count = query.match(/r\d+:/g)!.length;
        const data = Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`r${i}`, raw(`a/${i}`)]),
        );
        return { data, errors: [] };
      }),
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
      graphql: graphql(async () => ({
        data: { r0: raw("a/one"), r1: raw("a/two") },
        errors: [],
      })),
      starHistory: async (repo: string) => {
        if (repo === "a/two") throw new GitHubError(500, "boom");
        return HISTORY;
      },
    };
    const results = await fetchMetrics(github, ["a/one", "a/two"], NOW);
    expect(results.get("a/one")?.status).toBe("found");
    expect(results.get("a/two")).toEqual({ status: "failed", reason: "boom" });
  });

  it("fails only the repository whose activity query GitHub refuses", async () => {
    const github = {
      starHistory: async () => HISTORY,
      graphql: async <T>(query: string, variables: Record<string, unknown>) => {
        if (query.includes("recentOpen")) {
          if (variables.name === "two") throw new GitHubError(502, "timeout");
          return {
            data: ACTIVITY,
            errors: [],
          } as unknown as GraphQLResponse<T>;
        }
        return {
          data: { r0: raw("a/one"), r1: raw("a/two") },
          errors: [],
        } as unknown as GraphQLResponse<T>;
      },
    };
    const results = await fetchMetrics(github, ["a/one", "a/two"], NOW);
    expect(results.get("a/one")?.status).toBe("found");
    expect(results.get("a/two")).toEqual({
      status: "failed",
      reason: "timeout",
    });
  });
});
