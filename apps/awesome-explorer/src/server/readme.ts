// Turns an awesome list's README into the repositories it recommends. Only
// list items and table rows are read, so badges, prose, and footers that link
// to GitHub do not become entries.

import type { ListEntry } from "../shared/types.ts";

// GitHub paths that look like `owner/name` but are not repositories.
const RESERVED_OWNERS = new Set([
  "about",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "topics",
  "trending",
  "users",
]);

const REPO_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/#?\s]+)\/([^/#?\s]+)/i;
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const NAME = /^[\w.-]+$/;
const MARKDOWN_LINK =
  /\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?(https?:\/\/[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_LINK =
  /<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const ITEM_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|\||<li|<td|<tr)/i;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const SEPARATOR = /^\s*[-–—:]\s+(.+)$/;

/** `owner/name` for a GitHub repository URL, or null for any other link. */
export function repoFromUrl(url: string): string | null {
  const match = REPO_URL.exec(url);
  if (!match) return null;
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..")
    return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return `${owner}/${name}`;
}

/** Markdown and HTML reduced to readable text. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Link {
  url: string;
  text: string;
  end: number;
}

function linksIn(line: string): Link[] {
  const links: Link[] = [];
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    links.push({
      url: match[2]!,
      text: match[1]!,
      end: match.index + match[0].length,
    });
  }
  for (const match of line.matchAll(HTML_LINK)) {
    links.push({
      url: match[1]!,
      text: match[2]!,
      end: match.index + match[0].length,
    });
  }
  return links.sort((a, b) => a.end - b.end);
}

export function parseAwesomeList(
  markdown: string,
  listRepo: string,
): ListEntry[] {
  const self = listRepo.toLowerCase();
  const seen = new Set<string>();
  const entries: ListEntry[] = [];
  let section = "";
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      section = plainText(heading[1]!);
      continue;
    }
    if (!ITEM_LINE.test(line)) continue;

    let first = true;
    for (const link of linksIn(line)) {
      const repo = repoFromUrl(link.url);
      if (!repo) continue;
      const key = repo.toLowerCase();
      const isFirst = first;
      first = false;
      if (key === self || seen.has(key)) continue;
      seen.add(key);
      // The description follows the line's first repository link, after a dash or colon.
      const description = isFirst
        ? (SEPARATOR.exec(line.slice(link.end))?.[1] ?? "")
        : "";
      entries.push({
        repo,
        name: plainText(link.text) || repo.split("/")[1]!,
        section,
        description: plainText(description),
      });
    }
  }
  return entries;
}
