---
type: Architecture Decision Record
title: Write Awesome Explorer in TypeScript as One Deployable
description: Awesome Explorer ships as one TypeScript deployable whose choke point is browser execution of its interactive filter and sort UI.
scope: [apps/awesome-explorer]
tags: [deployable-boundary, lang:typescript]
generated: { by: "agent/claude-opus-5-5", at: "2026-10-22T00:00:00Z" }
superseded_by:
status: accepted
---

# Write Awesome Explorer in TypeScript as One Deployable

## Decision

`apps/awesome-explorer` is the only deployable: one long-lived Node process that fetches awesome-list and repository data from GitHub, caches it, and serves the browser UI that filters, sorts, and classifies those repositories. It is written in TypeScript end to end. This does not decide the storage engine, UI framework, or health-scoring model.

## Context

The product is an interactive page for exploring awesome lists, with filtering and sorting over repository health signals (stars, commit activity, open issues, open pull requests). The binding constraint is browser execution: the UI runs in the browser, which selects TypeScript. Chosen from the repo-builder short form, not measured. The server side is bound by nothing, so it shares the UI's language and types rather than adding a second one.

One deployable was chosen over a separate web client and API: the operator runs it on the homelab, and two services would mean two things to run and version together for no isolation benefit.

## Alternatives Considered

- **Web client and API as separate deployables** — rejected because nothing consumes the API except the UI; revisit if a second client (CLI, another service) needs the data.
- **Deployment glue, single-language ecosystem, many long-lived connections, hard memory limit** — checked and found not to bind: it is one HTTP service with modest data and no connection fan-out.
