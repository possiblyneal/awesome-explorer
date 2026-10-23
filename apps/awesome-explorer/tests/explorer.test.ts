import { describe, expect, it, vi } from "vitest";
import { Explorer } from "../src/server/explorer.ts";
import {
  RateLimitError,
  type GitHub,
  type SearchItem,
  type StarWeek,
} from "../src/server/github.ts";
import { Store } from "../src/server/store.ts";
import type { TrendingRepo } from "../src/shared/types.ts";
import { INDEX_LIST, STARS_LIST } from "../src/shared/index-list.ts";

const READMES: Record<string, string> = {
  [INDEX_LIST]:
    "## Platforms\n\n- [Listed](https://github.com/acme/awesome-listed) - In the index.",
  "acme/awesome-listed":
    "## Tools\n\n- [One](https://github.com/acme/one) - First.\n- [Two](https://github.com/acme/two) - Second.",
  "acme/awesome-unlisted": Array.from(
    { length: 50 },
    (_, i) => `- [Tool ${i}](https://github.com/acme/tool-${i})`,
  ).join("\n"),
  "acme/product": "# Product\n\n- [Docs](https://acme.dev/docs)",
};

function item(fullName: string, stars: number): SearchItem {
  return {
    full_name: fullName,
    description: null,
    stargazers_count: stars,
    pushed_at: "2026-10-01T00:00:00Z",
    topics: ["awesome-list"],
  };
}

function trend(repo: string, starsPerDay: number): TrendingRepo {
  return {
    repo,
    description: null,
    language: null,
    languageColor: null,
    stars: 1,
    gained: {},
    starsPerDay,
    image: null,
  };
}

const STAR_LISTS = {
  data: {
    viewer: {
      lists: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: "L1",
            name: "Tools",
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ nameWithOwner: "Acme/Starred" }, {}],
            },
          },
        ],
      },
    },
  },
  errors: [],
};

// Metrics never arrive, so every entry stays queued for the test to see; only
// the social preview query is answered, by `preview`, and star lists.
function explorer(
  search: SearchItem[] = [],
  trending: TrendingRepo[] = [],
  preview: (query: string) => Promise<unknown> = async () => ({
    data: {},
    errors: [],
  }),
  starHistory: (repo: string) => Promise<StarWeek[] | null> = async () => [],
): Explorer {
  const github = {
    readme: async (repo: string) => {
      if (repo === "acme/blocked") throw new Error("451 Unavailable");
      return READMES[repo] ?? null;
    },
    searchRepositories: async () => search,
    starred: async () => [
      { full_name: "acme/starred", name: "starred", description: null },
    ],
    graphql: async (query: string) =>
      query.includes("openGraphImageUrl")
        ? preview(query)
        : query.includes("viewer")
          ? STAR_LISTS
          : new Promise(() => {}),
    starHistory,
  };
  return new Explorer(
    github as unknown as GitHub,
    new Store(":memory:"),
    async () => trending,
  );
}

describe("Explorer.discover", () => {
  it("flags lists the index links to and leaves out the index itself", async () => {
    const lists = await explorer([
      item("acme/awesome-unlisted", 10),
      item("Acme/Awesome-Listed", 50),
      item(INDEX_LIST, 900),
    ]).discover("");
    expect(lists.map((list) => [list.repo, list.inIndex])).toEqual([
      ["Acme/Awesome-Listed", true],
      ["acme/awesome-unlisted", false],
    ]);
  });
  it("leaves out repositories whose README links to too little, or cannot be read", async () => {
    const lists = await explorer([
      item("acme/awesome-unlisted", 10),
      item("acme/product", 500),
      item("acme/no-readme", 400),
      item("acme/blocked", 300),
    ]).discover("");
    expect(lists.map((list) => list.repo)).toEqual(["acme/awesome-unlisted"]);
  });
});

describe("Explorer.list", () => {
  it("reports entries with no cached metrics as pending", async () => {
    const view = await explorer().list("acme/awesome-listed");
    expect(view.entries.map((entry) => entry.repo)).toEqual([
      "acme/one",
      "acme/two",
    ]);
    expect(view.pending).toBe(2);
    expect(view.entries[0]!.metrics).toBeUndefined();
  });

  it("finishes the other repositories while one is slow", async () => {
    const repository = (name: string) => ({
      nameWithOwner: name,
      description: null,
      url: `https://github.com/${name}`,
      isArchived: false,
      isFork: false,
      createdAt: "2020-01-01T00:00:00Z",
      stargazerCount: 1,
      hasIssuesEnabled: true,
      primaryLanguage: null,
      defaultBranchRef: null,
      latestRelease: null,
      licenseInfo: null,
      openIssues: { totalCount: 0 },
      openPullRequests: { totalCount: 0 },
    });
    const github = {
      readme: async () =>
        "- [One](https://github.com/acme/one)\n- [Slow](https://github.com/acme/slow)\n- [Two](https://github.com/acme/two)",
      starHistory: async () => [],
      graphql: async (query: string, variables: Record<string, unknown>) => {
        if (query.includes("recentOpen")) {
          if (variables.name === "slow") return new Promise(() => {});
          return {
            data: {
              recent: { issueCount: 0, nodes: [] },
              recentOpen: { issueCount: 0 },
              oldOpen: { issueCount: 0 },
              repository: null,
            },
            errors: [],
          };
        }
        const names = [...query.matchAll(/name: "([^"]+)"/g)];
        return {
          data: Object.fromEntries(
            names.map((match, index) => [
              `r${index}`,
              repository(`acme/${match[1]}`),
            ]),
          ),
          errors: [],
        };
      },
    };
    const subject = new Explorer(
      github as unknown as GitHub,
      new Store(":memory:"),
    );
    await subject.list("acme/awesome-listed");
    await vi.waitFor(async () => {
      const view = await subject.list("acme/awesome-listed");
      expect(view.pending).toBe(1);
      expect(view.entries.filter((entry) => entry.metrics)).toHaveLength(2);
    });
  });
});

describe("Explorer.stars", () => {
  it("explores the operator's starred repositories like a list", async () => {
    const view = await explorer().stars();
    expect(view.repo).toBe(STARS_LIST);
    expect(
      view.entries.map((entry) => [entry.repo, entry.description]),
    ).toEqual([["acme/starred", ""]]);
    expect(view.entries[0]!.lists).toEqual(["Tools"]);
    expect(view.pending).toBe(1);
  });
});

describe("Explorer.trending", () => {
  it("leaves out starred, dismissed, and snoozed repositories", async () => {
    const subject = explorer(
      [],
      ["acme/starred", "acme/dismissed", "acme/snoozed", "acme/new"].map(
        (repo, index) => trend(repo, 10 - index),
      ),
    );
    subject.dismiss("Acme/Dismissed");
    subject.snooze("acme/snoozed");
    expect((await subject.trending()).map((r) => r.repo)).toEqual(["acme/new"]);
  });

  it("keeps only uploaded social previews, once per refresh", async () => {
    const queries: string[] = [];
    const subject = explorer(
      [],
      ["acme/custom", "acme/generated", "acme/gone"].map((repo) =>
        trend(repo, 1),
      ),
      async (query) => {
        queries.push(query);
        return {
          data: {
            r0: {
              openGraphImageUrl:
                "https://repository-images.githubusercontent.com/1/a",
              usesCustomOpenGraphImage: true,
            },
            r1: {
              openGraphImageUrl:
                "https://opengraph.githubassets.com/x/acme/generated",
              usesCustomOpenGraphImage: false,
            },
            r2: null,
          },
          errors: [{ type: "NOT_FOUND", message: "gone" }],
        };
      },
    );
    const first = await subject.trending();
    await subject.trending();
    expect(first.map((r) => [r.repo, r.image])).toEqual([
      ["acme/custom", "https://repository-images.githubusercontent.com/1/a"],
      ["acme/generated", null],
      ["acme/gone", null],
    ]);
    expect(queries).toHaveLength(1);
  });

  it("batches lookups 100 repositories per query", async () => {
    const queries: string[] = [];
    const repos = Array.from({ length: 101 }, (_, i) => trend(`acme/r${i}`, 1));
    await explorer([], repos, async (query) => {
      queries.push(query);
      return { data: {}, errors: [] };
    }).trending();
    expect(queries).toHaveLength(2);
  });

  it("returns trending without images when the lookup hangs", async () => {
    vi.useFakeTimers();
    try {
      const result = explorer(
        [],
        [trend("acme/new", 1)],
        () => new Promise(() => {}),
      ).trending();
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await result).map((r) => [r.repo, r.image])).toEqual([
        ["acme/new", null],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still returns trending, without images, when the lookup fails", async () => {
    const subject = explorer([], [trend("acme/new", 1)], async () => {
      throw new Error("rate limited");
    });
    expect((await subject.trending()).map((r) => [r.repo, r.image])).toEqual([
      ["acme/new", null],
    ]);
  });

  it("ranks by stars per day over the last 7 days, else the trending page's weekly, monthly or best rate", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-23T12:00:00Z"),
      toFake: ["Date"],
    });
    try {
      // Two flat weeks, so any 7-day window averages `perDay`.
      const flat = (perDay: number): StarWeek[] =>
        ["2026-10-18", "2026-10-11"].map((week) => ({
          week: Date.parse(week) / 1000,
          total: perDay * 7,
          days: Array(7).fill(perDay),
        }));
      const histories: Record<string, () => Promise<StarWeek[] | null>> = {
        "acme/burst": async () => flat(5),
        "acme/steady": async () => flat(50),
        "acme/gone": async () => null,
        "acme/broken": async () => {
          throw new Error("502");
        },
        "acme/new": async () => null,
      };
      const subject = explorer(
        [],
        [
          trend("acme/burst", 900),
          { ...trend("acme/gone", 900), gained: { daily: 900, weekly: 280 } },
          { ...trend("acme/broken", 900), gained: { monthly: 600 } },
          trend("acme/steady", 10),
          trend("acme/new", 30),
        ],
        undefined,
        (repo) => histories[repo]!(),
      );
      expect(
        (await subject.trending()).map((r) => [r.repo, r.starsPerDay]),
      ).toEqual([
        ["acme/steady", 50],
        ["acme/gone", 40],
        ["acme/new", 30],
        ["acme/broken", 20],
        ["acme/burst", 5],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches a star rate at UTC midnight so one ranking keeps one window", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-23T23:00:00Z"),
      toFake: ["Date"],
    });
    try {
      let asked = 0;
      const subject = explorer(
        [],
        [trend("acme/new", 1)],
        undefined,
        async () => {
          asked++;
          return [];
        },
      );
      await subject.trending();
      vi.setSystemTime(new Date("2026-10-24T00:30:00Z"));
      await subject.trending();
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops looking up star histories at a rate limit", async () => {
    const asked: string[] = [];
    const repos = Array.from({ length: 9 }, (_, i) => trend(`acme/r${i}`, 1));
    await explorer([], repos, undefined, async (repo) => {
      asked.push(repo);
      if (repo === "acme/r0") throw new RateLimitError(new Date());
      return [];
    }).trending();
    expect(asked).toHaveLength(8);
  });

  it.each(["dismiss", "snooze"] as const)(
    "shows a repository again after restoring it from %s",
    async (action) => {
      const subject = explorer([], [trend("acme/new", 10)]);
      subject[action]("Acme/New");
      expect(await subject.trending()).toEqual([]);
      subject.restore("acme/NEW");
      expect((await subject.trending()).map((r) => r.repo)).toEqual([
        "acme/new",
      ]);
    },
  );
});

describe("Explorer.english", () => {
  function translating(translate: (text: string) => Promise<string>) {
    return new Explorer(
      {} as GitHub,
      new Store(":memory:"),
      async () => [],
      translate,
    );
  }

  it("translates other languages once and leaves plain English unasked", async () => {
    const asked: string[] = [];
    const subject = translating(async (text) => {
      asked.push(text);
      return "Set up a video site in one minute";
    });
    expect(await subject.english("The open source coding agent.")).toBe(
      "The open source coding agent.",
    );
    expect(await subject.english("一分钟搭建影视站")).toBe(
      "Set up a video site in one minute",
    );
    await subject.english("一分钟搭建影视站");
    expect(asked).toEqual(["一分钟搭建影视站"]);
  });

  it("answers the original when translation fails, and asks again next time", async () => {
    let calls = 0;
    const subject = translating(async () => {
      calls++;
      throw new Error("quota");
    });
    expect(await subject.english("Ferramenta de código")).toBe(
      "Ferramenta de código",
    );
    await subject.english("Ferramenta de código");
    expect(calls).toBe(2);
  });
});
