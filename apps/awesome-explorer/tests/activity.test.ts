import { describe, expect, it } from "vitest";
import {
  fetchActivity,
  summarizeActivity,
  type RawActivity,
} from "../src/server/activity.ts";
import type { GraphQLResponse } from "../src/server/github.ts";

const NOW = new Date("2026-10-01T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

type Item = RawActivity["recent"]["nodes"][number] & object;

function item(overrides: Partial<Item> & { closer?: string }): Item {
  const { closer, ...rest } = overrides;
  return {
    __typename: "Issue",
    createdAt: daysAgo(100),
    closedAt: null,
    authorAssociation: "NONE",
    timelineItems: {
      nodes: closer ? [{ actor: { __typename: closer } }] : [],
    },
    comments: { nodes: [] },
    ...rest,
  };
}

function activity(
  nodes: (Item | null)[],
  counts: { opened?: number; open?: number; oldOpen?: number } = {},
): RawActivity {
  return {
    recent: { issueCount: counts.opened ?? nodes.length, nodes },
    recentOpen: {
      issueCount:
        counts.open ?? nodes.filter((node) => node && !node.closedAt).length,
    },
    oldOpen: { issueCount: counts.oldOpen ?? 0 },
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            nodes: [
              { author: { email: "a@x.org", user: { login: "Ann" } } },
              { author: { email: "ann@y.org", user: { login: "ann" } } },
              { author: { email: "bob@x.org", user: null } },
              { author: null },
              null,
            ],
          },
        },
      },
    },
  };
}

const humanClosed = (days: number) =>
  item({
    createdAt: daysAgo(100),
    closedAt: daysAgo(100 - days),
    closer: "User",
  });

describe("summarizeActivity", () => {
  it("counts merged and human-closed items as handled, bot-closed and open ones not", () => {
    const summary = summarizeActivity(
      activity([
        humanClosed(1),
        item({
          __typename: "PullRequest",
          closedAt: daysAgo(98),
          mergedAt: daysAgo(98),
          closer: "User",
        }),
        item({ closedAt: daysAgo(40), closer: "Bot" }),
        item({}),
      ]),
      10,
      NOW,
    );
    expect(summary.backlog).toBe(0.5);
  });

  it("estimates the backlog beyond the sample from its bot-closed share", () => {
    // 1 of the 4 sampled closed items was a bot's; 20 of 100 opened are open.
    const nodes = [
      humanClosed(1),
      humanClosed(2),
      humanClosed(3),
      item({ closedAt: daysAgo(40), closer: "Bot" }),
    ];
    expect(
      summarizeActivity(activity(nodes, { opened: 100, open: 20 }), 10, NOW)
        .backlog,
    ).toBe((20 + 80 * 0.25) / 100);
  });

  it("counts an unhandled item at its age so far in the median", () => {
    const nodes = [
      humanClosed(1),
      humanClosed(2),
      item({ createdAt: daysAgo(300) }),
      item({ createdAt: daysAgo(200), closedAt: daysAgo(199), closer: "Bot" }),
      item({ createdAt: daysAgo(250) }),
      null,
    ];
    expect(summarizeActivity(activity(nodes), 10, NOW).medianHandleDays).toBe(
      200,
    );
  });

  it("leaves medians and shares unknown on fewer than 5 sampled items", () => {
    const summary = summarizeActivity(activity([humanClosed(1)]), 0, NOW);
    expect(summary).toMatchObject({
      medianHandleDays: null,
      unansweredShare: null,
      medianMergeDays: null,
      oldOpenShare: null,
    });
    expect(
      summarizeActivity(activity([], { opened: 0 }), 0, NOW).backlog,
    ).toBeNull();
  });

  it("calls an outside issue answered once a maintainer replies or a person handles it", () => {
    const reply = (authorAssociation: string) => ({
      comments: { nodes: [{ authorAssociation }, null] },
    });
    const nodes = [
      item(reply("MEMBER")),
      item(reply("NONE")),
      item({}),
      humanClosed(5),
      item({ closedAt: daysAgo(40), closer: "Bot" }),
      item({ authorAssociation: "OWNER" }),
    ];
    expect(summarizeActivity(activity(nodes), 10, NOW).unansweredShare).toBe(
      3 / 5,
    );
  });

  it("calls a window with no outside issues fully answered, and 1 to 4 unknown", () => {
    const own = item({ authorAssociation: "OWNER" });
    expect(summarizeActivity(activity([own]), 1, NOW).unansweredShare).toBe(0);
    expect(
      summarizeActivity(activity([own, item({})]), 1, NOW).unansweredShare,
    ).toBeNull();
  });

  it("takes the median merge days over merged pull requests", () => {
    const merged = (days: number) =>
      item({
        __typename: "PullRequest",
        createdAt: daysAgo(50),
        closedAt: daysAgo(50 - days),
        mergedAt: daysAgo(50 - days),
      });
    const nodes = [1, 2, 3, 4, 10].map(merged);
    expect(summarizeActivity(activity(nodes), 10, NOW).medianMergeDays).toBe(3);
  });

  it("shares open items opened over a year ago and counts distinct committers", () => {
    const summary = summarizeActivity(activity([], { oldOpen: 3 }), 12, NOW);
    expect(summary.oldOpenShare).toBe(0.25);
    // Ann's two emails share a login.
    expect(summary.committers90d).toBe(2);
  });
});

describe("fetchActivity", () => {
  it("searches the window by the name given and fails on any GraphQL error", async () => {
    let variables: Record<string, unknown> = {};
    const github = {
      graphql: async <T>(_query: string, vars: Record<string, unknown>) => {
        variables = vars;
        return {
          data: activity([]),
          errors: [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "too much" }],
        } as unknown as GraphQLResponse<T>;
      },
    };
    await expect(fetchActivity(github, "react/react", NOW)).rejects.toThrow(
      "too much",
    );
    expect(variables).toMatchObject({
      recent:
        "repo:react/react created:2025-10-01..2026-09-17 sort:created-desc",
      recentOpen: "repo:react/react created:2025-10-01..2026-09-17 is:open",
      oldOpen: "repo:react/react is:open created:<2025-10-01",
      owner: "react",
      name: "react",
    });
  });
});
