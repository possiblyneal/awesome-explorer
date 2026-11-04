import { describe, expect, it } from "vitest";
import { assessHealth } from "../src/server/health.ts";
import type { RepoMetrics } from "../src/shared/types.ts";

const NOW = new Date("2026-10-01T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

function repo(overrides: Partial<RepoMetrics>): RepoMetrics {
  return {
    repo: "acme/thing",
    description: null,
    url: "https://github.com/acme/thing",
    archived: false,
    fork: false,
    createdAt: daysAgo(2000),
    lastCommitAt: daysAgo(10),
    commits90d: 20,
    committers90d: 6,
    stars: 5000,
    stars30d: 20,
    language: "TypeScript",
    license: "MIT",
    lastReleaseAt: daysAgo(30),
    issuesEnabled: true,
    openIssues: 50,
    openPullRequests: 5,
    oldOpenShare: 0.1,
    backlog: 0.05,
    medianHandleDays: 3,
    unansweredShare: 0.1,
    medianMergeDays: 2,
    ...overrides,
  };
}

describe("assessHealth", () => {
  it("calls an archived repository dead and scores it zero", () => {
    expect(assessHealth(repo({ archived: true }), NOW)).toMatchObject({
      label: "dead",
      score: 0,
    });
  });

  it("calls a repository with no commit for two years dead", () => {
    expect(assessHealth(repo({ lastCommitAt: daysAgo(740) }), NOW).label).toBe(
      "dead",
    );
    expect(assessHealth(repo({ lastCommitAt: null }), NOW).label).toBe("dead");
  });

  it("calls a repository gaining stars fast rising, whatever its age", () => {
    expect(assessHealth(repo({ stars: 9000, stars30d: 600 }), NOW).label).toBe(
      "rising",
    );
    // A big repository's steady gain is popularity, not growth.
    expect(
      assessHealth(repo({ stars: 50_000, stars30d: 900 }), NOW).label,
    ).not.toBe("rising");
    // A fast share of a few stars is not popular yet.
    expect(
      assessHealth(repo({ stars: 800, stars30d: 300 }), NOW).label,
    ).not.toBe("rising");
    expect(
      assessHealth(
        repo({ stars: 9000, stars30d: 600, lastCommitAt: daysAgo(100) }),
        NOW,
      ).label,
    ).not.toBe("rising");
  });

  it("calls a year-old repository keeping its backlog small mature, whatever its size or pace", () => {
    expect(assessHealth(repo({}), NOW).label).toBe("mature");
    expect(
      assessHealth(
        repo({
          stars: 40,
          commits90d: 400,
          openIssues: 900,
          openPullRequests: 200,
          lastCommitAt: daysAgo(300),
        }),
        NOW,
      ).label,
    ).toBe("mature");
    expect(assessHealth(repo({ backlog: null }), NOW).label).toBe("mature");
    // Too new for a small backlog to mean few bugs.
    expect(assessHealth(repo({ createdAt: daysAgo(200) }), NOW).label).toBe(
      "active",
    );
  });

  it("calls a repository with no commit for over a year stale", () => {
    expect(
      assessHealth(repo({ lastCommitAt: daysAgo(400), commits90d: 0 }), NOW)
        .label,
    ).toBe("stale");
  });

  it("calls everything else active", () => {
    expect(assessHealth(repo({ backlog: 0.15 }), NOW).label).toBe("active");
    expect(
      assessHealth(
        repo({ backlog: 0.3, commits90d: 0, lastCommitAt: daysAgo(300) }),
        NOW,
      ).label,
    ).toBe("active");
  });

  it("ranks a responsive repository above a neglected one", () => {
    const responsive = assessHealth(repo({}), NOW).score;
    const neglected = assessHealth(
      repo({
        lastCommitAt: daysAgo(300),
        medianHandleDays: 90,
        openIssues: 900,
        backlog: 0.9,
      }),
      NOW,
    ).score;
    expect(responsive).toBeGreaterThan(neglected);
    expect(responsive).toBeLessThanOrEqual(100);
  });
});
