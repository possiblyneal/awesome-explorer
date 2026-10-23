// Turns an awesome list's README into the repositories it recommends. Only
// list items, quoted items, and table rows are read, so badges, prose, and
// footers that link to GitHub do not become entries.

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
// A quoted line counts only when an item or a link opens it, so a blockquote
// tagline that mentions other lists stays prose.
const ITEM_LINE =
  /^\s*(?:[-*+]\s|\d+[.)]\s|>\s*(?:[-*+]\s|\d+[.)]\s|\**\[)|\||<li|<td|<tr)/i;
// A table's divider row; the rows under it need not start with a pipe.
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const SEPARATOR = /^\s*(?:[-–—:]\s+(.+)|\|\s*([^|]+))/;

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

/** Removes tags until none remain, so a removal cannot join two halves into a new tag. */
export function stripTags(html: string): string {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return text;
}

/** Markdown and HTML reduced to readable text. */
function plainText(markdown: string): string {
  return stripTags(
    markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
  )
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
  let inTable = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (TABLE_DIVIDER.test(line)) {
      inTable = true;
      continue;
    }
    if (!line.trim()) inTable = false;

    const heading = HEADING.exec(line);
    if (heading) {
      section = plainText(heading[1]!);
      continue;
    }
    if (!ITEM_LINE.test(line) && !(inTable && line.includes("|"))) continue;

    let first = true;
    for (const link of linksIn(line)) {
      const repo = repoFromUrl(link.url);
      if (!repo) continue;
      const key = repo.toLowerCase();
      const isFirst = first;
      first = false;
      if (key === self || seen.has(key)) continue;
      seen.add(key);
      // The description follows the line's first repository link, after a
      // dash or colon, or in the table cell after it.
      const separated = isFirst ? SEPARATOR.exec(line.slice(link.end)) : null;
      const description = separated?.[1] ?? separated?.[2] ?? "";
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

const OUTBOUND_LINK =
  /(?<!!)\[[^\]]*\]\(\s*<?(https?:\/\/[^)\s>]+)|href=["'](https?:\/\/[^"']+)|<(https?:\/\/[^>\s]+)>/gi;
const IMAGE_URL = /\.(?:svg|png|gif|jpe?g|webp)$/;

/**
 * Distinct links out of the README, wherever they sit, leaving out images,
 * linked badges, and the repository's own pages. Curated lists carry
 * hundreds; product READMEs that tag themselves `awesome` carry a few dozen
 * at most.
 */
export function countOutboundLinks(markdown: string, repo: string): number {
  const own = `github.com/${repo.toLowerCase()}`;
  const targets = new Set<string>();
  for (const match of markdown.matchAll(OUTBOUND_LINK)) {
    const url = (match[1] ?? match[2] ?? match[3])!
      .toLowerCase()
      .replace(/^https?:\/\/(?:www\.)?/, "")
      .replace(/[#?].*$/, "")
      .replace(/\/$/, "");
    if (url === own || url.startsWith(`${own}/`) || IMAGE_URL.test(url))
      continue;
    targets.add(url);
  }
  return targets.size;
}
