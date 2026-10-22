import { describe, expect, it } from "vitest";
import { Explorer } from "../src/server/explorer.ts";
import type { GitHub, SearchItem } from "../src/server/github.ts";
import { Store } from "../src/server/store.ts";
import { INDEX_LIST } from "../src/shared/index-list.ts";

const READMES: Record<string, string> = {
  [INDEX_LIST]:
    "## Platforms\n\n- [Listed](https://github.com/acme/awesome-listed) - In the index.",
  "acme/awesome-listed":
    "## Tools\n\n- [One](https://github.com/acme/one) - First.\n- [Two](https://github.com/acme/two) - Second.",
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

// Metrics never arrive, so every entry stays queued for the test to see.
function explorer(search: SearchItem[] = []): Explorer {
  const github = {
    readme: async (repo: string) => READMES[repo] ?? null,
    searchRepositories: async () => search,
    graphql: () => new Promise(() => {}),
    starHistory: async () => [],
  };
  return new Explorer(github as unknown as GitHub, new Store(":memory:"));
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
