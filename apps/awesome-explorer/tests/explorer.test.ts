import { describe, expect, it } from "vitest";
import { Explorer } from "../src/server/explorer.ts";
import type { GitHub, SearchItem } from "../src/server/github.ts";
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
  };
}

// Metrics never arrive, so every entry stays queued for the test to see.
function explorer(
  search: SearchItem[] = [],
  trending: TrendingRepo[] = [],
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
    graphql: () => new Promise(() => {}),
    starHistory: async () => [],
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
});

describe("Explorer.stars", () => {
  it("explores the operator's starred repositories like a list", async () => {
    const view = await explorer().stars();
    expect(view.repo).toBe(STARS_LIST);
    expect(
      view.entries.map((entry) => [entry.repo, entry.description]),
    ).toEqual([["acme/starred", ""]]);
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
