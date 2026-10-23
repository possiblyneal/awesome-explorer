import type {
  DiscoveredList,
  ListView,
  TrendingRepo,
} from "../shared/types.ts";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body;
}

export function fetchList(repo: string): Promise<ListView> {
  return getJson(`/api/lists/${repo}`);
}

export function fetchStars(): Promise<ListView> {
  return getJson("/api/stars");
}

export function fetchDiscover(query: string): Promise<DiscoveredList[]> {
  return getJson(`/api/discover?${new URLSearchParams({ q: query })}`);
}

export function fetchTrending(): Promise<TrendingRepo[]> {
  return getJson("/api/trending");
}

/** Undoes a dismissal or snooze. */
export async function restoreTrending(repo: string): Promise<void> {
  const response = await fetch(`/api/trending/${repo}`, { method: "DELETE" });
  if (!response.ok)
    throw new Error(`undo failed: ${response.status} ${response.statusText}`);
}

/** Hides a trending repository for good (`dismiss`) or for 30 days (`snooze`). */
export async function hideTrending(
  repo: string,
  action: "dismiss" | "snooze",
): Promise<void> {
  const response = await fetch(`/api/trending/${repo}/${action}`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(
      `${action} failed: ${response.status} ${response.statusText}`,
    );
}
