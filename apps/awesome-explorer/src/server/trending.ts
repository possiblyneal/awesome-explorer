// GitHub's trending pages, read as HTML since GitHub offers no trending API.
// Every combination of period, coding language, and spoken language the
// operator follows is fetched and merged into one ranking.

import type { TrendingPeriod, TrendingRepo } from "../shared/types.ts";
import { stripTags } from "./readme.ts";

const PERIODS: Record<TrendingPeriod, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};
/** URL slugs; the empty one is every language. */
const LANGUAGES = [
  "",
  "python",
  "typescript",
  "javascript",
  "rust",
  "go",
  "c++",
  "c",
];
/** Spoken-language codes; the empty one is every spoken language. */
const SPOKEN = ["", "en"];
const CONCURRENCY = 8;

const ROW = /<article class="Box-row">([\s\S]*?)<\/article>/g;
const NAME = /<h2[^>]*>\s*<a[^>]*href="\/([\w.-]+\/[\w.-]+)"/;
const DESCRIPTION = /<p class="col-9[^"]*">([\s\S]*?)<\/p>/;
const LANGUAGE = /itemprop="programmingLanguage">([^<]+)</;
const STARS = /\/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/;
const GAINED = /([\d,]+) stars (?:today|this week|this month)/;

export interface TrendingRow {
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  gained: number;
}

function count(text: string): number {
  return Number(text.replace(/,/g, ""));
}

/** Tags stripped, then entities decoded, `&amp;` last so `&amp;lt;` stays `&lt;`. */
function decode(html: string): string {
  return stripTags(html)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The repositories on one trending page, in GitHub's order. */
export function parseTrending(html: string): TrendingRow[] {
  const rows: TrendingRow[] = [];
  for (const [, row] of html.matchAll(ROW)) {
    const repo = NAME.exec(row!)?.[1];
    if (!repo) continue;
    const description = DESCRIPTION.exec(row!)?.[1];
    rows.push({
      repo,
      description: description ? decode(description) || null : null,
      language: LANGUAGE.exec(row!)?.[1]?.trim() ?? null,
      stars: count(STARS.exec(row!)?.[1] ?? "0"),
      gained: count(GAINED.exec(row!)?.[1] ?? "0"),
    });
  }
  return rows;
}

function pageUrl(period: TrendingPeriod, language: string, spoken: string) {
  const params = new URLSearchParams({ since: period });
  if (spoken) params.set("spoken_language_code", spoken);
  const path = language ? `/${encodeURIComponent(language)}` : "";
  return `https://github.com/trending${path}?${params}`;
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "awesome-explorer" },
  });
  if (!response.ok)
    throw new Error(`GitHub trending ${url}: ${response.status}`);
  return response.text();
}

/**
 * Every followed trending page merged, one row per repository, ranked by its
 * best stars gained per day across the periods it trends in. Pages that fail
 * to load are left out.
 */
export async function fetchTrending(
  load: (url: string) => Promise<string> = fetchPage,
): Promise<TrendingRepo[]> {
  const pages = (Object.keys(PERIODS) as TrendingPeriod[]).flatMap((period) =>
    LANGUAGES.flatMap((language) =>
      SPOKEN.map((spoken) => ({
        period,
        url: pageUrl(period, language, spoken),
      })),
    ),
  );
  const byRepo = new Map<string, TrendingRepo>();
  const failures: unknown[] = [];
  for (let start = 0; start < pages.length; start += CONCURRENCY) {
    const batch = pages.slice(start, start + CONCURRENCY);
    const htmls = await Promise.allSettled(batch.map((page) => load(page.url)));
    batch.forEach(({ period }, index) => {
      const html = htmls[index]!;
      if (html.status === "rejected") {
        failures.push(html.reason);
        return;
      }
      for (const row of parseTrending(html.value)) {
        const key = row.repo.toLowerCase();
        const merged = byRepo.get(key) ?? {
          repo: row.repo,
          description: row.description,
          language: row.language,
          stars: row.stars,
          gained: {},
          starsPerDay: 0,
        };
        merged.gained[period] = row.gained;
        merged.starsPerDay = Math.max(
          merged.starsPerDay,
          row.gained / PERIODS[period],
        );
        byRepo.set(key, merged);
      }
    });
  }
  // One failed page only thins the ranking; every page failing is an outage.
  if (failures.length === pages.length) throw failures[0];
  return [...byRepo.values()].sort((a, b) => b.starsPerDay - a.starsPerDay);
}
