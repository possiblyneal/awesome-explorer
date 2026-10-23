// Answers the UI's two questions: what does this list recommend and how
// healthy is each entry, and which awesome lists exist. A list answers
// straight from the cache; entries with no metrics, or metrics older than a
// day, join a background queue the UI polls on until it drains.

import type {
  DiscoveredList,
  ExploredEntry,
  ListEntry,
  ListView,
  TrendingRepo,
} from "../shared/types.ts";
import { INDEX_LIST, STARS_LIST } from "../shared/index-list.ts";
import { RateLimitError, type GitHub } from "./github.ts";
import { assessHealth } from "./health.ts";
import { BATCH_SIZE, fetchMetrics, type MetricsResult } from "./metrics.ts";
import { countOutboundLinks, parseAwesomeList } from "./readme.ts";
import type { Cached, Store } from "./store.ts";
import { fetchTrending } from "./trending.ts";

const HOUR = 3_600_000;
const FRESH_FOR = 24 * HOUR;
const STARS_FRESH_FOR = HOUR;
const TRENDING_FRESH_FOR = HOUR;
const SNOOZE_FOR = 30 * 24 * HOUR;
const FAILED_FRESH_FOR = HOUR;
const DISCOVER_FRESH_FOR = HOUR / 6;
const RETRY_AFTER_ERROR = 60_000;
/** Fewest README links a list outside the index needs; measured products stop near 30, lists start past 80. */
const MIN_LIST_LINKS = 50;
/** README fetches in flight at once while vetting discovery candidates. */
const README_CONCURRENCY = 10;

export class NotFoundError extends Error {}

function isFresh(cached: Cached<MetricsResult>, now: number): boolean {
  const ttl = cached.value.status === "failed" ? FAILED_FRESH_FOR : FRESH_FOR;
  return now - cached.fetchedAt < ttl;
}

function explore(
  entry: ListEntry,
  cached: Cached<MetricsResult> | undefined,
  now: Date,
): ExploredEntry {
  const result = cached?.value;
  switch (result?.status) {
    case "found":
      return {
        ...entry,
        metrics: result.metrics,
        health: assessHealth(result.metrics, now),
      };
    case "missing":
      return { ...entry, unavailable: "GitHub has no such repository" };
    case "failed":
      return { ...entry, unavailable: `fetching it failed: ${result.reason}` };
    default:
      return entry;
  }
}

export class Explorer {
  #github: GitHub;
  #store: Store;
  /** Lowercased names waiting for metrics, including the batch in flight. */
  #queue = new Set<string>();
  #draining = false;
  #queueError: string | undefined;
  #listLoads = new Map<string, Promise<Cached<ListEntry[]>>>();
  #discoveries = new Map<
    string,
    { at: number; lists: Promise<DiscoveredList[]> }
  >();

  #trending: { at: number; repos: Promise<TrendingRepo[]> } | undefined;
  #fetchTrending: typeof fetchTrending;

  constructor(
    github: GitHub,
    store: Store,
    trending: typeof fetchTrending = fetchTrending,
  ) {
    this.#github = github;
    this.#store = store;
    this.#fetchTrending = trending;
  }

  list(repo: string): Promise<ListView> {
    return this.#view(repo, () => this.#loadList(repo));
  }

  /** The operator's starred repositories, explored like a list's entries. */
  stars(): Promise<ListView> {
    return this.#view(STARS_LIST, () => this.#loadStars());
  }

  /** Trending repositories the operator has not starred, dismissed, or snoozed. */
  async trending(): Promise<TrendingRepo[]> {
    if (
      !this.#trending ||
      Date.now() - this.#trending.at >= TRENDING_FRESH_FOR
    ) {
      const repos = this.#fetchTrending();
      this.#trending = { at: Date.now(), repos };
      repos.catch(() => (this.#trending = undefined));
    }
    const [repos, stars] = await Promise.all([
      this.#trending.repos,
      this.#loadStars(),
    ]);
    const hidden = this.#store.getDismissed(Date.now());
    for (const entry of stars.value) hidden.add(entry.repo.toLowerCase());
    return repos.filter((repo) => !hidden.has(repo.repo.toLowerCase()));
  }

  /** Hides a repository from trending for good. */
  dismiss(repo: string): void {
    this.#store.putDismissal(repo.toLowerCase(), null);
  }

  /** Hides a repository from trending for 30 days. */
  snooze(repo: string): void {
    this.#store.putDismissal(repo.toLowerCase(), Date.now() + SNOOZE_FOR);
  }

  /** Undoes a dismissal or snooze. */
  restore(repo: string): void {
    this.#store.deleteDismissal(repo.toLowerCase());
  }

  async #view(
    repo: string,
    load: () => Promise<Cached<ListEntry[]> & { error?: string }>,
  ): Promise<ListView> {
    const now = new Date();
    const { value: entries, fetchedAt, error } = await load();
    const keys = entries.map((entry) => entry.repo.toLowerCase());
    const cached = this.#store.getMetrics(keys);

    for (const key of keys) {
      const hit = cached.get(key);
      if (!hit || !isFresh(hit, now.getTime())) this.#queue.add(key);
    }
    void this.#drain();

    return {
      repo,
      fetchedAt: new Date(fetchedAt).toISOString(),
      entries: entries.map((entry, index) =>
        explore(entry, cached.get(keys[index]!), now),
      ),
      pending: keys.filter((key) => this.#queue.has(key)).length,
      error: error ?? this.#queueError,
    };
  }

  /** Awesome lists matching the query, or the most starred ones when it is empty. */
  discover(query: string): Promise<DiscoveredList[]> {
    const key = query.trim().toLowerCase();
    const cached = this.#discoveries.get(key);
    if (cached && Date.now() - cached.at < DISCOVER_FRESH_FOR)
      return cached.lists;
    const lists = this.#search(key);
    this.#discoveries.set(key, { at: Date.now(), lists });
    lists.catch(() => this.#discoveries.delete(key));
    return lists;
  }

  async #search(query: string): Promise<DiscoveredList[]> {
    const searches = query
      ? [`${query} topic:awesome-list`, `${query} awesome in:name`]
      : ["topic:awesome-list", "topic:awesome"];
    const [results, index] = await Promise.all([
      Promise.all(
        searches.map((search) => this.#github.searchRepositories(search)),
      ),
      this.#loadList(INDEX_LIST),
    ]);
    const indexed = new Set(
      index.value.map((entry) => entry.repo.toLowerCase()),
    );
    const byName = new Map(
      results.flat().map((item) => [item.full_name.toLowerCase(), item]),
    );
    byName.delete(INDEX_LIST);
    const unindexed = [...byName.keys()].filter((key) => !indexed.has(key));
    const links = await this.#readmeLinks(unindexed);
    return [...byName.values()]
      .filter((item) => {
        const key = item.full_name.toLowerCase();
        return indexed.has(key) || (links.get(key) ?? 0) >= MIN_LIST_LINKS;
      })
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .map((item) => ({
        repo: item.full_name,
        description: item.description,
        stars: item.stargazers_count,
        pushedAt: item.pushed_at,
        topics: item.topics ?? [],
        inIndex: indexed.has(item.full_name.toLowerCase()),
      }));
  }

  /**
   * Each repository's README link count, refetched when a day old; no README
   * counts as none, and an unreadable one keeps its stale count or is left out.
   */
  async #readmeLinks(keys: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const stale: string[] = [];
    for (const key of keys) {
      const cached = this.#store.getReadmeLinks(key);
      if (cached && Date.now() - cached.fetchedAt < FRESH_FOR)
        counts.set(key, cached.value);
      else stale.push(key);
    }
    for (let start = 0; start < stale.length; start += README_CONCURRENCY) {
      await Promise.all(
        stale.slice(start, start + README_CONCURRENCY).map(async (key) => {
          try {
            const readme = await this.#github.readme(key);
            const count = readme === null ? 0 : countOutboundLinks(readme, key);
            this.#store.putReadmeLinks(key, count, Date.now());
            counts.set(key, count);
          } catch (error) {
            if (error instanceof RateLimitError) throw error;
            // One unreadable README drops that candidate, not the search.
            const cached = this.#store.getReadmeLinks(key);
            if (cached) counts.set(key, cached.value);
          }
        }),
      );
    }
    return counts;
  }

  /** The list's entries, refetched when a day old; a failed refetch serves the stale copy. */
  #loadList(repo: string): Promise<Cached<ListEntry[]> & { error?: string }> {
    return this.#load(repo.toLowerCase(), FRESH_FOR, () =>
      this.#fetchList(repo),
    );
  }

  #loadStars(): Promise<Cached<ListEntry[]> & { error?: string }> {
    return this.#load(STARS_LIST, STARS_FRESH_FOR, () => this.#fetchStars());
  }

  async #load(
    key: string,
    freshFor: number,
    fetchEntries: () => Promise<ListEntry[]>,
  ): Promise<Cached<ListEntry[]> & { error?: string }> {
    const cached = this.#store.getList(key);
    if (cached && Date.now() - cached.fetchedAt < freshFor) return cached;

    let load = this.#listLoads.get(key);
    if (!load) {
      load = this.#fetchAndStore(key, fetchEntries).finally(() =>
        this.#listLoads.delete(key),
      );
      this.#listLoads.set(key, load);
    }
    try {
      return await load;
    } catch (error) {
      if (!cached || error instanceof NotFoundError) throw error;
      return {
        ...cached,
        error: `showing a cached copy: ${(error as Error).message}`,
      };
    }
  }

  async #fetchAndStore(
    key: string,
    fetchEntries: () => Promise<ListEntry[]>,
  ): Promise<Cached<ListEntry[]>> {
    const list = { value: await fetchEntries(), fetchedAt: Date.now() };
    this.#store.putList(key, list.value, list.fetchedAt);
    return list;
  }

  async #fetchList(repo: string): Promise<ListEntry[]> {
    const readme = await this.#github.readme(repo);
    if (readme === null)
      throw new NotFoundError(`${repo} has no README on GitHub`);
    return parseAwesomeList(readme, repo);
  }

  async #fetchStars(): Promise<ListEntry[]> {
    return (await this.#github.starred()).map((item) => ({
      repo: item.full_name,
      name: item.name,
      section: "",
      description: item.description ?? "",
    }));
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.size > 0) {
        const batch = [...this.#queue].slice(0, BATCH_SIZE);
        try {
          const results = await fetchMetrics(this.#github, batch, new Date());
          const fetchedAt = Date.now();
          for (const [key, result] of results) {
            this.#store.putMetrics(key, result, fetchedAt);
            this.#queue.delete(key);
          }
          this.#queueError = undefined;
        } catch (error) {
          const resumeAt =
            error instanceof RateLimitError
              ? error.resetAt.getTime()
              : Date.now() + RETRY_AFTER_ERROR;
          this.#queueError = `${(error as Error).message}; retrying at ${new Date(resumeAt).toLocaleTimeString()}`;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(resumeAt - Date.now(), 1000)),
          );
        }
      }
    } finally {
      this.#draining = false;
    }
  }
}
