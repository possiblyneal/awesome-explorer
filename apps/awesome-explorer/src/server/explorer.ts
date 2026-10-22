// Answers the UI's two questions: what does this list recommend and how
// healthy is each entry, and which awesome lists exist. A list answers
// straight from the cache; entries with no metrics, or metrics older than a
// day, join a background queue the UI polls on until it drains.

import type {
  DiscoveredList,
  ExploredEntry,
  ListEntry,
  ListView,
} from "../shared/types.ts";
import { RateLimitError, type GitHub } from "./github.ts";
import { assessHealth } from "./health.ts";
import { BATCH_SIZE, fetchMetrics, type MetricsResult } from "./metrics.ts";
import { parseAwesomeList } from "./readme.ts";
import type { Cached, Store } from "./store.ts";

export const INDEX_LIST = "sindresorhus/awesome";

const HOUR = 3_600_000;
const FRESH_FOR = 24 * HOUR;
const FAILED_FRESH_FOR = HOUR;
const DISCOVER_FRESH_FOR = HOUR / 6;
const RETRY_AFTER_ERROR = 60_000;

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

  constructor(github: GitHub, store: Store) {
    this.#github = github;
    this.#store = store;
  }

  async list(repo: string): Promise<ListView> {
    const now = new Date();
    const { value: entries, fetchedAt, error } = await this.#loadList(repo);
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
    return [...byName.values()]
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

  /** The list's entries, refetched when a day old; a failed refetch serves the stale copy. */
  async #loadList(
    repo: string,
  ): Promise<Cached<ListEntry[]> & { error?: string }> {
    const key = repo.toLowerCase();
    const cached = this.#store.getList(key);
    if (cached && Date.now() - cached.fetchedAt < FRESH_FOR) return cached;

    let load = this.#listLoads.get(key);
    if (!load) {
      load = this.#fetchList(repo, key).finally(() =>
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

  async #fetchList(repo: string, key: string): Promise<Cached<ListEntry[]>> {
    const readme = await this.#github.readme(repo);
    if (readme === null)
      throw new NotFoundError(`${repo} has no README on GitHub`);
    const list = {
      value: parseAwesomeList(readme, repo),
      fetchedAt: Date.now(),
    };
    this.#store.putList(key, list.value, list.fetchedAt);
    return list;
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
