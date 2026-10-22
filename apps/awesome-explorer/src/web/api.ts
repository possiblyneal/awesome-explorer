import type { DiscoveredList, ListView } from "../shared/types.ts";

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

export function fetchDiscover(query: string): Promise<DiscoveredList[]> {
  return getJson(`/api/discover?${new URLSearchParams({ q: query })}`);
}
