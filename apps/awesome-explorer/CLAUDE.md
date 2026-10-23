## Purpose

The explorer app: an Express server that reads awesome lists, the operator's stars, and GitHub trending, and fetches metrics from GitHub, and a React UI that filters, sorts, and labels them.

## Ownership

Single operator. Runs longlived (`.unit.json`), started by `scripts/run`, which runs `npm run dev`; `npm start` serves the built UI in production.

## Local Contracts

- Layout:
  - `src/server/` — Node only. `github.ts` (fetch client, classifies rate limits vs refusals), `readme.ts` (list parsing, outbound link count), `metrics.ts` (GraphQL batches plus star history), `health.ts` (labels and score), `store.ts` (SQLite: cached lists, metrics, README link counts, plus trending dismissals, which are operator data and not a cache), `trending.ts` (trending page scraping and ranking), `explorer.ts` (refresh queue, discovery), `config.ts`, `main.ts` (routes, Vite middleware in dev).
  - `src/web/` — browser only, built by Vite into `dist/web/`.
  - `src/shared/` — imported by both sides and the only code they share: `types.ts` (the API's JSON shapes, backlog shares included) and `index-list.ts` (the index list's name, and `STARS_LIST`, the key stars are viewed and cached under).
- Node runs the TypeScript directly by type stripping, so server code uses only erasable syntax (`erasableSyntaxOnly`) and `.ts` import extensions. The dev server loads `vite.config.ts` with `configLoader: "native"` (see `docs/LESSONS.md`).
- Config: `GITHUB_TOKEN` (else `gh auth token`), `HOST` (default `127.0.0.1`), `PORT` (default `4321`), `NODE_ENV=production`. The cache is `state/cache.db`.
- Routes: `/api/lists/:owner/:name`, `/api/stars` (the token user's starred repositories, `#/stars` in the UI), `/api/trending` (`#/trending`), `POST /api/trending/:owner/:name/{dismiss,snooze}`, `DELETE /api/trending/:owner/:name` (undo, 204), `/api/discover?q=`.
- List parsing reads bullet, numbered, and table lines, and `>` quoted lines that an item or link opens (a quoted tagline stays prose); a `---|---` divider marks the rows under it as a table even without leading pipes.
- Trending scrapes `github.com/trending` HTML (no API exists): 3 periods × `LANGUAGES` × `SPOKEN` in `trending.ts`, 8 pages at a time. Rows merge by repository and rank by the best `gained / period days`. A markup change on GitHub breaks `parseTrending` silently; `tests/trending.test.ts` pins the row shape. Each row carries its language swatch color (`languageColor`, null without a language; first seen wins on merge). The UI (`TrendingView.tsx`) shows a card grid (3/2/1 columns), 48 cards at a time with an IntersectionObserver sentinel adding 48 more; a card links to GitHub, and Snooze and ✕ hide it without opening the link, and a bottom undo bar (about 5 s) puts the last hidden card back at its index.
- Discovery keeps a search result only if the index links to it or its README has `MIN_LIST_LINKS` (50) distinct outbound links (`countOutboundLinks`); topics are self-applied, so product repositories tagged `awesome` would otherwise pass. Measured: products stop near 30, unindexed lists start past 80. An unreadable README drops only that candidate; a rate limit fails the search. A failed trending page is left out of the ranking; every page failing is an error.
- Cache freshness: lists, metrics, and README link counts 24h, stars 1h, trending 1h (in memory), a failed repository 1h, discovery 10 min. Metrics drain in the background; the API returns what it has plus a `pending` count and the UI polls.
- Health labels, first match wins: `dead` (archived, or no commit in 365 days), `rising` (commit within 90 days, under 2 years old, and 50+ stars in 30 days or 5%+ growth with 10+), `mature` (3+ years, 1000+ stars, commit within 180 days, open issue share ≤ 25%), `active` (commit within 90 days, and 5+ commits in 90 days or a median issue close of 7 days or less), else `stale`. `tests/health.test.ts` pins each rule; change both together.
- Per-repository failures stay per-repository: a refused GraphQL batch is split until the failing repository stands alone, and a refused star history fails only its repository. Rate limits (secondary limits included, waited out for a minute), network errors, and a 5xx that fails every repository in the whole batch propagate and pause the queue instead of caching failures. The UI keeps polling through a failed request while metrics were pending.

## Work Guidance

- Read `docs/LESSONS.md` before changing a GitHub query: GraphQL partial refusals and the stargazer restriction both fail silently.
- A finished library with no commit in a year reads as `dead`; that is a known limit of commit-based activity, not a bug.

## Verification

- `npm test` (vitest over `tests/`), `npm run typecheck`, `npm run lint`, `npm run build`; `scripts/check` at the root runs all of them.

## Child Index
