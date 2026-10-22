import { useEffect, useState } from "react";
import type { TrendingRepo } from "../shared/types.ts";
import { fetchTrending, hideTrending } from "./api.ts";
import { compact, listHref } from "./format.ts";

const SHOWN = 50;

function gain(value: number | undefined): string {
  return value === undefined ? "—" : `+${compact(value)}`;
}

/** Trending repositories across every followed period and language, minus the operator's stars and dismissals. */
export function TrendingView() {
  const [repos, setRepos] = useState<TrendingRepo[]>();
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTrending().then(
      (result) => !cancelled && setRepos(result),
      (reason: Error) => !cancelled && setError(reason.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function hide(repo: string, action: "dismiss" | "snooze") {
    try {
      await hideTrending(repo, action);
      setRepos((current) => current?.filter((r) => r.repo !== repo));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const visible = showAll ? (repos ?? []) : (repos ?? []).slice(0, SHOWN);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Trending on GitHub</h2>
        {repos && (
          <span className="muted">
            {repos.length} repositories you have not starred, ranked by stars
            per day
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!repos && !error && <p className="muted">Reading 48 trending pages…</p>}
      {repos && repos.length === 0 && (
        <p className="muted">Nothing new is trending.</p>
      )}
      {visible.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Language</th>
              <th className="num">Stars</th>
              <th className="num">Today</th>
              <th className="num">This week</th>
              <th className="num">This month</th>
              <th className="num">Per day</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((repo) => (
              <tr key={repo.repo}>
                <td>
                  <a
                    href={`https://github.com/${repo.repo}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {repo.repo}
                  </a>{" "}
                  <a
                    className="muted"
                    href={listHref(repo.repo)}
                    title="Open this repository as an awesome list"
                  >
                    as list
                  </a>
                  {repo.description && (
                    <div className="description">{repo.description}</div>
                  )}
                </td>
                <td>{repo.language ?? "—"}</td>
                <td className="num">{compact(repo.stars)}</td>
                <td className="num">{gain(repo.gained.daily)}</td>
                <td className="num">{gain(repo.gained.weekly)}</td>
                <td className="num">{gain(repo.gained.monthly)}</td>
                <td className="num">{compact(repo.starsPerDay)}</td>
                <td>
                  <button
                    className="link"
                    title="Never show this repository here again"
                    onClick={() => void hide(repo.repo, "dismiss")}
                  >
                    Dismiss
                  </button>{" "}
                  <button
                    className="link"
                    title="Hide this repository for 30 days"
                    onClick={() => void hide(repo.repo, "snooze")}
                  >
                    Snooze
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!showAll && repos && repos.length > SHOWN && (
        <button className="link" onClick={() => setShowAll(true)}>
          Show all {repos.length}
        </button>
      )}
    </section>
  );
}
