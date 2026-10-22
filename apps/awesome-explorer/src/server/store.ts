// The SQLite cache under the unit's state/ folder: each list's parsed entries,
// each repository's last metrics result, and each discovery candidate's README
// link count, all keyed by lowercased `owner/name` and stamped with when they
// were fetched. It also keeps the operator's trending dismissals, the one
// thing here that a refetch cannot rebuild.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ListEntry } from "../shared/types.ts";
import type { MetricsResult } from "./metrics.ts";

export interface Cached<T> {
  value: T;
  fetchedAt: number;
}

export class Store {
  #db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS lists (repo TEXT PRIMARY KEY, entries TEXT NOT NULL, fetched_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics (repo TEXT PRIMARY KEY, result TEXT NOT NULL, fetched_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS readme_links (repo TEXT PRIMARY KEY, links INTEGER NOT NULL, fetched_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dismissals (repo TEXT PRIMARY KEY, until INTEGER);
    `);
  }

  getList(key: string): Cached<ListEntry[]> | undefined {
    const row = this.#db
      .prepare("SELECT entries, fetched_at FROM lists WHERE repo = ?")
      .get(key) as { entries: string; fetched_at: number } | undefined;
    return (
      row && {
        value: JSON.parse(row.entries) as ListEntry[],
        fetchedAt: row.fetched_at,
      }
    );
  }

  putList(key: string, entries: ListEntry[], fetchedAt: number): void {
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO lists (repo, entries, fetched_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(entries), fetchedAt);
  }

  getMetrics(keys: string[]): Map<string, Cached<MetricsResult>> {
    const rows = this.#db
      .prepare(
        "SELECT repo, result, fetched_at FROM metrics WHERE repo IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(keys)) as {
      repo: string;
      result: string;
      fetched_at: number;
    }[];
    return new Map(
      rows.map((row) => [
        row.repo,
        {
          value: JSON.parse(row.result) as MetricsResult,
          fetchedAt: row.fetched_at,
        },
      ]),
    );
  }

  putMetrics(key: string, result: MetricsResult, fetchedAt: number): void {
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO metrics (repo, result, fetched_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(result), fetchedAt);
  }

  getReadmeLinks(key: string): Cached<number> | undefined {
    const row = this.#db
      .prepare("SELECT links, fetched_at FROM readme_links WHERE repo = ?")
      .get(key) as { links: number; fetched_at: number } | undefined;
    return row && { value: row.links, fetchedAt: row.fetched_at };
  }

  putReadmeLinks(key: string, links: number, fetchedAt: number): void {
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO readme_links (repo, links, fetched_at) VALUES (?, ?, ?)",
      )
      .run(key, links, fetchedAt);
  }

  /** Hides a repository from trending until `until`, or for good when null. */
  putDismissal(key: string, until: number | null): void {
    this.#db
      .prepare("INSERT OR REPLACE INTO dismissals (repo, until) VALUES (?, ?)")
      .run(key, until);
  }

  /** Repositories hidden from trending at `now`. */
  getDismissed(now: number): Set<string> {
    const rows = this.#db
      .prepare("SELECT repo FROM dismissals WHERE until IS NULL OR until > ?")
      .all(now) as { repo: string }[];
    return new Set(rows.map((row) => row.repo));
  }
}
