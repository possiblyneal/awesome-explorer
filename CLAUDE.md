## Template Contract

These sections are identical in every repository built from the template. Do not edit them here: a repository whose shape needs to differ has found a gap in the template, so fix it there and let the next template update (`/repo-builder`) carry it. This repository's own instructions start at Purpose.

### Commands

Use these instead of per-language tools. `check` and `fix` run for every language present and report `pass`, `not-applicable`, `unavailable`, or `FAIL`.

- `scripts/check` — the full local gate, a superset of CI except the pull request's changelog check: doctor, script tests, structure, lint, format, type check, test, build, security audit, pre-commit over every file. Prints only the Result table, with the full run in `tmp/check.log`; `--verbose` streams everything
- `scripts/fix` — lint autofix, then formatting
- `scripts/summarize <command…>` — run a check and print only its Result table; read `ci` and other commands through this, since `check` already does
- `scripts/run [unit] [--entry <name>] [-- args…]` — start a unit; the unit name is required when `apps/` holds several

`ls scripts/` lists the rest, such as `doctor`, `integration`, and `package`.

### Layout

`scripts/check` fails on any of these; pre-commit runs `scripts/structure` over the placement rules on every commit.

- Root holds only `apps/`, `docs/`, `libs/`, `scripts/`, `tests/`, `tools/`, `deploy/`, `assets/`, `gradle/`, `tmp/`, and the dot-folders `.claude/`, `.github/`, `.devcontainer/`.
- Root files are permitted by name: the shipped dotfiles, `CLAUDE.md`, `GLOSSARY.md`, `GLOSSARY-MAP.md`, `.gitmodules`, `.structure-allow`, `.repo-template.json`, adopted addons, and each language's root manifests and lockfiles. Any other root file or folder needs an entry in `.structure-allow`.
- `apps/<unit>/` is one unit: the smallest piece delivered on its own. Its code goes in `apps/<unit>/src/`. Nothing sits directly in `apps/`.
- Split a unit into domains only for distinct business areas: `apps/<unit>/<domain>/src/`. A unit has `src/` or domains, never both. Domains do not nest.
- A root, unit, or domain may hold its own `libs/`, `tests/`, `scripts/`, `tools/`, `assets/`, `docs/`, or `deploy/`, scoped to it. These never contain `src/`.
- `tools/` holds one directory per program, never loose files.
- `deploy/` holds only `quadlet/`, `containerfile/`, `compose/`, `systemd/`, and `env/`.
- `docs/` takes Markdown; anything else there needs `.structure-allow`.
- Below a `src/`, the language decides the layout.
- A path ending in `/` in `.structure-allow` exempts that whole prefix, for vendored or fixture trees.
- A package whose language has no root manifest fails the gate; add the root workspace manifest (`go.work`, `settings.gradle.kts`, and so on) that lists it. Swift is excepted: it has no root manifest.

These are conventions `scripts/structure` does not check:

- Root-level `libs/`, `tests/`, `scripts/`, `tools/`, `deploy/`, and `assets/` hold only what spans several units.
- Files a program reads go in `assets/`. Files it writes while running go in `apps/<unit>/state/`, which is gitignored.
- `tests/integration/` is the integration tier, run by `scripts/integration` and left out of the gate.

Every unit has a `.unit.json` at its root, never at a domain's:

```json
{ "schema_version": 1, "run": "oneshot", "ships": { "kind": "executable", "targets": ["linux-amd64"] } }
```

- `run`: `oneshot` (exits on its own), `longlived` (runs until stopped), or `none`.
- `ships.kind`: `executable`, `quadlet`, or `none`. `ships.targets` (`linux-amd64`, `macos-arm64`) is required for `executable` and rejected otherwise.
- Any pairing of `run` and `ships` is valid.

## Purpose

Awesome Explorer: a web app for exploring GitHub awesome lists. It reads a list's README, fetches each linked repository's metrics, and labels its health so the operator can see what is best now, what is rising, and what to skip. `sindresorhus/awesome` is the root, and discovery searches GitHub for lists the root leaves out.

## Ownership

Single operator (see `GLOSSARY.md`). One unit, `apps/awesome-explorer`, run longlived on the homelab.

## Local Contracts

- The root `package.json` is an npm workspace over `apps/awesome-explorer`; its scripts delegate to the member, which is what `scripts/check` runs.
- The GitHub token comes from `GITHUB_TOKEN` or `gh auth token` at startup. Never commit or log it.
- Runtime data lives in `apps/awesome-explorer/state/` (gitignored SQLite cache); deleting it only costs a refetch.

## Work Guidance

- Domain words (list, entry, index, discovery, health label) are defined in `GLOSSARY.md`; use them.
- GitHub API quirks this app depends on are in `docs/LESSONS.md`; read it before changing a query.

## Verification

- `scripts/check` — the full gate, including the unit's typecheck, lint, vitest suite, and vite build.

## Child Index

- `apps/awesome-explorer/CLAUDE.md` — the app: server, web UI, shared types, health rules, and GitHub data fetching
