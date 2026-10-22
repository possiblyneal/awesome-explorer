## Purpose

The explorer app: an Express server that reads awesome lists and fetches metrics from GitHub, and a React UI that filters, sorts, and labels each list's entries.

## Ownership

Single operator. Runs longlived (`.unit.json`), started by `scripts/run`, which runs `npm run dev`; `npm start` serves the built UI in production.

## Local Contracts

- Layout:
  - `src/server/` — Node only. `github.ts` (fetch client, classifies rate limits vs refusals), `readme.ts` (list parsing), `metrics.ts` (GraphQL batches plus star history), `health.ts` (labels and score), `store.ts` (SQLite cache), `explorer.ts` (refresh queue, discovery), `config.ts`, `main.ts` (routes, Vite middleware in dev).
  - `src/web/` — browser only, built by Vite into `dist/web/`.
  - `src/shared/types.ts` — the API's JSON shapes, imported by both sides; the only code they share.
- Node runs the TypeScript directly by type stripping, so server code uses only erasable syntax (`erasableSyntaxOnly`) and `.ts` import extensions.
- Config: `GITHUB_TOKEN` (else `gh auth token`), `HOST` (default `127.0.0.1`), `PORT` (default `4321`), `NODE_ENV=production`. The cache is `state/cache.db`.
- Cache freshness: lists and metrics 24h, a failed repository 1h, discovery 10 min. Metrics drain in the background; the API returns what it has plus a `pending` count and the UI polls.
- Health labels, first match wins: `dead` (archived, or no commit in 365 days), `rising` (commit within 90 days, under 2 years old, and 50+ stars in 30 days or 5%+ growth with 10+), `mature` (3+ years, 1000+ stars, commit within 180 days, open issue share ≤ 25%), `active` (commit within 90 days and 5+ commits in 90 days), else `stale`. `tests/health.test.ts` pins each rule; change both together.
- Per-repository failures stay per-repository: a refused GraphQL batch is split until the failing repository stands alone, and a refused star history fails only its repository. Rate limits and network errors propagate and pause the queue.

## Work Guidance

- Read `docs/LESSONS.md` before changing a GitHub query: GraphQL partial refusals and the stargazer restriction both fail silently.
- A finished library with no commit in a year reads as `dead`; that is a known limit of commit-based activity, not a bug.

## Verification

- `npm test` (vitest over `tests/`), `npm run typecheck`, `npm run lint`, `npm run build`; `scripts/check` at the root runs all of them.

## Child Index
