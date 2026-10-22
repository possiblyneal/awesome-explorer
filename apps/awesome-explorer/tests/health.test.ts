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
    createdAt: daysAgo(2000),
    lastCommitAt: daysAgo(10),
    commits90d: 20,
    stars: 5000,
    stars30d: 20,
    language: "TypeScript",
    issuesEnabled: true,
    openIssues: 50,
    closedIssues: 950,
    openPullRequests: 5,
    mergedPullRequests: 500,
    issueBacklog: 0.05,
    pullRequestBacklog: 0.01,
    medianIssueCloseDays: 3,
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

  it("calls a repository with no commit for a year dead", () => {
    expect(assessHealth(repo({ lastCommitAt: daysAgo(400) }), NOW).label).toBe(
      "dead",
    );
    expect(assessHealth(repo({ lastCommitAt: null }), NOW).label).toBe("dead");
  });

  it("calls a young repository gaining stars fast rising", () => {
    const young = { createdAt: daysAgo(200), stars: 800 };
    expect(assessHealth(repo({ ...young, stars30d: 60 }), NOW).label).toBe(
      "rising",
    );
    expect(assessHealth(repo({ ...young, stars30d: 45 }), NOW).label).toBe(
      "rising",
    );
    expect(
      assessHealth(repo({ ...young, stars: 5000, stars30d: 15 }), NOW).label,
    ).not.toBe("rising");
  });

  it("calls an established, maintained repository with a small backlog mature", () => {
    expect(assessHealth(repo({}), NOW).label).toBe("mature");
    expect(
      assessHealth(
        repo({ openIssues: 400, closedIssues: 600, issueBacklog: 0.4 }),
        NOW,
      ).label,
    ).toBe("active");
  });

  it("calls a busy repository that is not established active", () => {
    expect(assessHealth(repo({ stars: 300 }), NOW).label).toBe("active");
  });

  it("calls a lightly developed repository that fixes issues fast active", () => {
    const light = { stars: 300, commits90d: 2 };
    const fast = assessHealth(repo({ ...light, medianIssueCloseDays: 7 }), NOW);
    expect(fast).toMatchObject({ label: "active" });
    expect(fast.reasons[0]).toContain("fixing issues fast");
    expect(
      assessHealth(repo({ ...light, medianIssueCloseDays: 8 }), NOW).label,
    ).toBe("stale");
  });

  it("calls a quiet repository stale", () => {
    expect(
      assessHealth(
        repo({ stars: 300, lastCommitAt: daysAgo(200), commits90d: 0 }),
        NOW,
      ).label,
    ).toBe("stale");
  });

  it("ranks a responsive repository above a neglected one", () => {
    const responsive = assessHealth(repo({}), NOW).score;
    const neglected = assessHealth(
      repo({
        lastCommitAt: daysAgo(300),
        medianIssueCloseDays: 90,
        openIssues: 900,
        closedIssues: 100,
        issueBacklog: 0.9,
      }),
      NOW,
    ).score;
    expect(responsive).toBeGreaterThan(neglected);
    expect(responsive).toBeLessThanOrEqual(100);
  });
});
