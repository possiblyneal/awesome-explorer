import { useEffect, useState } from "react";
import type { DiscoveredList } from "../shared/types.ts";
import { fetchDiscover } from "./api.ts";
import { ago, compact, listHref } from "./format.ts";

const SHOWN = 15;

/** Awesome lists found by searching GitHub, flagging those the index leaves out. */
export function DiscoverView({ query }: { query: string }) {
  const [lists, setLists] = useState<DiscoveredList[]>();
  const [error, setError] = useState<string>();
  const [missingOnly, setMissingOnly] = useState(query === "");
  const [showAll, setShowAll] = useState(query !== "");

  useEffect(() => {
    let cancelled = false;
    fetchDiscover(query).then(
      (result) => !cancelled && setLists(result),
      (reason: Error) => !cancelled && setError(reason.message),
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  const shown = (lists ?? []).filter((list) => !missingOnly || !list.inIndex);
  const visible = showAll ? shown : shown.slice(0, SHOWN);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {query
            ? `Awesome lists matching “${query}”`
            : "Popular awesome lists"}
        </h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)}
          />
          only lists missing from sindresorhus/awesome
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!lists && !error && <p className="muted">Searching GitHub…</p>}
      {lists && shown.length === 0 && <p className="muted">No lists found.</p>}
      {visible.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>List</th>
              <th className="num">Stars</th>
              <th className="num">Last push</th>
              <th>In index</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((list) => (
              <tr key={list.repo}>
                <td>
                  <a href={listHref(list.repo)}>{list.repo}</a>
                  {list.description && (
                    <div className="description">{list.description}</div>
                  )}
                </td>
                <td className="num">{compact(list.stars)}</td>
                <td className="num">{ago(list.pushedAt)}</td>
                <td>
                  {list.inIndex ? (
                    "yes"
                  ) : (
                    <span className="chip chip-new">not indexed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!showAll && shown.length > SHOWN && (
        <button className="link" onClick={() => setShowAll(true)}>
          Show all {shown.length}
        </button>
      )}
    </section>
  );
}
