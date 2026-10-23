import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/server/store.ts";

// The repository's own scratch folder, not the system temp directory.
const SCRATCH = new URL("../../../tmp/", import.meta.url).pathname;
let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Store", () => {
  it("drops metrics cached before their shape last changed, once", () => {
    dir = mkdtempSync(SCRATCH);
    const path = join(dir, "cache.db");
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE metrics (repo TEXT PRIMARY KEY, result TEXT NOT NULL, fetched_at INTEGER NOT NULL);" +
        `INSERT INTO metrics VALUES ('a/old', '{"status":"missing"}', 1)`,
    );
    old.close();

    expect(new Store(path).getMetrics(["a/old"]).size).toBe(0);
    const store = new Store(path);
    store.putMetrics("a/new", { status: "missing" }, 2);
    expect(new Store(path).getMetrics(["a/new"]).size).toBe(1);
  });
});
