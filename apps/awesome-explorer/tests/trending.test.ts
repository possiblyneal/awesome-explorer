import { describe, expect, it } from "vitest";
import { fetchTrending, parseTrending } from "../src/server/trending.ts";

function row(repo: string, gained: string, period = "this week"): string {
  return `<article class="Box-row">
<h2 class="h3 lh-condensed">
<a data-hydro-click="{}" href="/${repo}" class="Link"><svg></svg>
<span class="text-normal">${repo.split("/")[0]} /</span>${repo.split("/")[1]}</a></h2>
<p class="col-9 color-fg-muted my-1 tmp-pr-4">
Builds &amp; ships <b>things</b> &amp;lt;3.
</p>
<div class="f6 color-fg-muted mt-2">
<span itemprop="programmingLanguage">C++</span>
<a href="/${repo}/stargazers" class="Link"><svg aria-label="star"><path d="M8"></path>
</svg>
9,045</a>
<span class="d-inline-block float-sm-right"><svg></svg>
${gained} stars ${period}
</span></div>
</article>`;
}

describe("parseTrending", () => {
  it("reads each row's repository, description, language, and star counts", () => {
    expect(parseTrending(row("juce-framework/JUCE", "1,081"))).toEqual([
      {
        repo: "juce-framework/JUCE",
        description: "Builds & ships things &lt;3.",
        language: "C++",
        stars: 9045,
        gained: 1081,
      },
    ]);
  });
});

describe("fetchTrending", () => {
  it("merges every page into one row per repository, ranked by best stars per day", async () => {
    const urls: string[] = [];
    const repos = await fetchTrending(async (url) => {
      urls.push(url);
      if (url.includes("since=daily")) return row("a/daily", "50", "today");
      if (url.includes("since=weekly"))
        return row("A/Daily", "70") + row("b/weekly", "700");
      return row("c/monthly", "600", "this month");
    });
    expect(urls).toHaveLength(48);
    expect(urls).toContain(
      "https://github.com/trending/c%2B%2B?since=monthly&spoken_language_code=en",
    );
    expect(repos.map((r) => [r.repo, r.starsPerDay])).toEqual([
      ["b/weekly", 100],
      ["a/daily", 50],
      ["c/monthly", 20],
    ]);
    expect(repos[1]!.gained).toEqual({ daily: 50, weekly: 70 });
  });

  it("ranks the pages that loaded when others fail", async () => {
    const repos = await fetchTrending(async (url) => {
      if (url.includes("since=daily")) throw new Error("429");
      return row("b/weekly", "700");
    });
    expect(repos.map((r) => r.repo)).toEqual(["b/weekly"]);
  });

  it("fails when every page fails", async () => {
    await expect(
      fetchTrending(async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });
});
