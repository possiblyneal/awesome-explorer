import { useEffect, useMemo, useState } from "react";
import type {
  ExploredEntry,
  HealthLabel,
  ListView as ListData,
} from "../shared/types.ts";
import { fetchList } from "./api.ts";
import { ago, compact, listHref } from "./format.ts";

const POLL_MS = 3000;

const LABELS: { label: HealthLabel; title: string }[] = [
  { label: "mature", title: "Mature: the safe pick" },
  { label: "active", title: "Active: under steady development" },
  { label: "rising", title: "Rising: the up-and-comers" },
  { label: "stale", title: "Stale: maintained only occasionally" },
  { label: "dead", title: "Dead: archived or abandoned" },
];

type SortValue = number | string | null | undefined;

interface Column {
  key: string;
  title: string;
  hint?: string;
  numeric?: boolean;
  value: (entry: ExploredEntry) => SortValue;
}

const daysAgo = (iso: string | null | undefined) =>
  iso ? -Date.parse(iso) : undefined;
const ratio = (open: number, done: number) =>
  open + done === 0 ? undefined : open / (open + done);

const COLUMNS: Column[] = [
  { key: "name", title: "Repository", value: (e) => e.repo.toLowerCase() },
  {
    key: "score",
    title: "Health",
    numeric: true,
    value: (e) => e.health?.score,
  },
  {
    key: "stars",
    title: "Stars",
    numeric: true,
    value: (e) => e.metrics?.stars,
  },
  {
    key: "stars30d",
    title: "+30d",
    hint: "stars gained in the last 30 days",
    numeric: true,
    value: (e) => e.metrics?.stars30d,
  },
  {
    key: "commit",
    title: "Last commit",
    numeric: true,
    value: (e) => daysAgo(e.metrics?.lastCommitAt),
  },
  {
    key: "commits",
    title: "Commits 90d",
    numeric: true,
    value: (e) => e.metrics?.commits90d,
  },
  {
    key: "issues",
    title: "Open issues",
    numeric: true,
    value: (e) => e.metrics?.openIssues,
  },
  {
    key: "prs",
    title: "Open PRs",
    numeric: true,
    value: (e) => e.metrics?.openPullRequests,
  },
  {
    key: "close",
    title: "Issue close",
    hint: "median days to close an issue, over the last 20 closed",
    numeric: true,
    value: (e) => e.metrics?.medianIssueCloseDays,
  },
  {
    key: "backlog",
    title: "Backlog",
    hint: "share of all issues ever opened that are still open",
    numeric: true,
    value: (e) =>
      e.metrics && ratio(e.metrics.openIssues, e.metrics.closedIssues),
  },
];

interface Filters {
  text: string;
  labels: Set<HealthLabel>;
  section: string;
  language: string;
  minStars: number;
}

function matches(entry: ExploredEntry, filters: Filters): boolean {
  if (
    filters.labels.size > 0 &&
    (!entry.health || !filters.labels.has(entry.health.label))
  )
    return false;
  if (filters.section && entry.section !== filters.section) return false;
  if (filters.language && entry.metrics?.language !== filters.language)
    return false;
  if (filters.minStars > 0 && (entry.metrics?.stars ?? 0) < filters.minStars)
    return false;
  if (filters.text) {
    const haystack = `${entry.repo} ${entry.name} ${entry.description} ${entry.metrics?.description ?? ""}`;
    if (!haystack.toLowerCase().includes(filters.text.toLowerCase()))
      return false;
  }
  return true;
}

/** Compares with missing values last, whichever the direction. */
function compare(a: SortValue, b: SortValue, descending: boolean): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const order = a < b ? -1 : 1;
  return descending ? -order : order;
}

function useList(repo: string) {
  const [data, setData] = useState<ListData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const view = await fetchList(repo);
        if (cancelled) return;
        setData(view);
        setError(undefined);
        if (view.pending > 0) timer = window.setTimeout(load, POLL_MS);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repo]);

  return { data, error };
}

function HealthCell({ entry }: { entry: ExploredEntry }) {
  if (entry.unavailable)
    return <span className="muted">{entry.unavailable}</span>;
  if (!entry.health) return <span className="muted">loading…</span>;
  return (
    <span
      className={`chip chip-${entry.health.label}`}
      title={entry.health.reasons.join("\n")}
    >
      {entry.health.label} {entry.health.score}
    </span>
  );
}

function Row({ entry }: { entry: ExploredEntry }) {
  const m = entry.metrics;
  const backlog = m && ratio(m.openIssues, m.closedIssues);
  return (
    <tr className={m?.archived ? "archived" : undefined}>
      <td>
        <a
          href={m?.url ?? `https://github.com/${entry.repo}`}
          target="_blank"
          rel="noreferrer"
        >
          {entry.name}
        </a>{" "}
        <span className="muted">{entry.repo}</span>
        <a
          className="explore"
          href={listHref(m?.repo ?? entry.repo)}
          title="Open this repository as an awesome list"
        >
          explore →
        </a>
        <div className="description">{entry.description || m?.description}</div>
        <div className="tags">
          {entry.section && <span>{entry.section}</span>}
          {m?.language && <span>{m.language}</span>}
        </div>
      </td>
      <td>
        <HealthCell entry={entry} />
      </td>
      <td className="num">{m ? compact(m.stars) : ""}</td>
      <td className="num">{m?.stars30d ? `+${compact(m.stars30d)}` : ""}</td>
      <td className="num">{m ? ago(m.lastCommitAt) : ""}</td>
      <td className="num">{m?.commits90d ?? ""}</td>
      <td className="num">
        {m ? (m.issuesEnabled ? compact(m.openIssues) : "off") : ""}
      </td>
      <td className="num">{m ? compact(m.openPullRequests) : ""}</td>
      <td className="num">
        {m?.medianIssueCloseDays != null ? `${m.medianIssueCloseDays}d` : ""}
      </td>
      <td className="num">
        {backlog !== undefined ? `${Math.round(backlog * 100)}%` : ""}
      </td>
    </tr>
  );
}

export function ListView({ repo }: { repo: string }) {
  const { data, error } = useList(repo);
  const [filters, setFilters] = useState<Filters>({
    text: "",
    labels: new Set(),
    section: "",
    language: "",
    minStars: 0,
  });
  const [sort, setSort] = useState({ key: "score", descending: true });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const sections = useMemo(
    () => [...new Set(entries.map((e) => e.section).filter(Boolean))],
    [entries],
  );
  const languages = useMemo(
    () =>
      [
        ...new Set(
          entries.flatMap((e) =>
            e.metrics?.language ? [e.metrics.language] : [],
          ),
        ),
      ].sort(),
    [entries],
  );
  const counts = useMemo(() => {
    const byLabel = new Map<HealthLabel, number>();
    for (const e of entries)
      if (e.health)
        byLabel.set(e.health.label, (byLabel.get(e.health.label) ?? 0) + 1);
    return byLabel;
  }, [entries]);
  const rows = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0]!;
    return entries
      .filter((e) => matches(e, filters))
      .sort((a, b) =>
        compare(column.value(a), column.value(b), sort.descending),
      );
  }, [entries, filters, sort]);

  function toggleLabel(label: HealthLabel) {
    const labels = new Set(filters.labels);
    if (!labels.delete(label)) labels.add(label);
    setFilters({ ...filters, labels });
  }

  function sortBy(column: Column) {
    setSort((current) =>
      current.key === column.key
        ? { key: column.key, descending: !current.descending }
        : { key: column.key, descending: Boolean(column.numeric) },
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
          >
            {repo}
          </a>
        </h2>
        {data && (
          <span className="muted">
            {entries.length} repositories
            {data.pending > 0 && ` · fetching metrics for ${data.pending}…`}
          </span>
        )}
      </div>
      {(error ?? data?.error) && (
        <p className="error">{error ?? data?.error}</p>
      )}
      {!data && !error && <p className="muted">Reading the list…</p>}
      {data && entries.length === 0 && (
        <p className="muted">This README links to no GitHub repositories.</p>
      )}
      {entries.length > 0 && (
        <>
          <div className="filters">
            {LABELS.map(({ label, title }) => (
              <button
                key={label}
                className={`chip chip-${label} ${filters.labels.has(label) ? "selected" : ""}`}
                title={title}
                onClick={() => toggleLabel(label)}
              >
                {label} {counts.get(label) ?? 0}
              </button>
            ))}
            <input
              value={filters.text}
              onChange={(event) =>
                setFilters({ ...filters, text: event.target.value })
              }
              placeholder="Filter by name or description"
              aria-label="Filter by name or description"
            />
            {sections.length > 1 && (
              <select
                value={filters.section}
                onChange={(event) =>
                  setFilters({ ...filters, section: event.target.value })
                }
                aria-label="Section"
              >
                <option value="">All sections</option>
                {sections.map((section) => (
                  <option key={section}>{section}</option>
                ))}
              </select>
            )}
            {languages.length > 1 && (
              <select
                value={filters.language}
                onChange={(event) =>
                  setFilters({ ...filters, language: event.target.value })
                }
                aria-label="Language"
              >
                <option value="">All languages</option>
                {languages.map((language) => (
                  <option key={language}>{language}</option>
                ))}
              </select>
            )}
            <label>
              min stars{" "}
              <input
                type="number"
                min={0}
                step={100}
                value={filters.minStars}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    minStars: Number(event.target.value),
                  })
                }
              />
            </label>
            <span className="muted">{rows.length} shown</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={column.numeric ? "num" : undefined}
                      title={column.hint}
                    >
                      <button className="sort" onClick={() => sortBy(column)}>
                        {column.title}
                        {sort.key === column.key
                          ? sort.descending
                            ? " ↓"
                            : " ↑"
                          : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <Row key={entry.repo} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
