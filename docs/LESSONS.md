# Lessons learned

A lesson is a durable, repeatable, non-obvious constraint, convention, or tool quirk; leave out incident history and generic advice.
Each lesson has a short imperative `##` title, the rule, **Do:** the required action, **Why:** the consequence (only when not self-evident), and **Source:** a link to the authority.

## Lessons

## Treat any GraphQL error other than NOT_FOUND as a refused batch

A query over GitHub's resource budget still returns HTTP 200, with `RESOURCE_LIMITS_EXCEEDED` errors and the fields it gave up on nulled, so partial data looks like real zeros.

**Do:** split the batch on any error whose `type` is not `NOT_FOUND`, and keep `BATCH_SIZE` in `apps/awesome-explorer/src/server/metrics.ts` at a size measured to pass.
**Why:** a 25-repository batch silently labeled healthy repositories dead.
**Source:** https://docs.github.com/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api

## Read recent stars from the star history endpoint

GitHub restricted stargazer listings to admins and collaborators in 2026: GraphQL `stargazers` returns `totalCount: 0` and REST `/stargazers` returns 404, without an error.

**Do:** use `GET /repos/{owner}/{repo}/stargazers/history`, weekly buckets newest first with per-day counts.
**Source:** https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/

## Load the Vite config natively under node --watch

Vite's default `bundle` config loader writes a temp `.mjs` copy of `vite.config.ts`, imports it, then deletes it; `node --watch` sees that import change and restarts the dev server in a loop.

**Do:** keep `configLoader: "native"` in the `createServer` call in `apps/awesome-explorer/src/server/main.ts`.
**Source:** https://vite.dev/guide/cli
