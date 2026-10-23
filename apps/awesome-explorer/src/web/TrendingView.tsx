import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { TrendingRepo } from "../shared/types.ts";
import { fetchTrending, hideTrending } from "./api.ts";
import { compact } from "./format.ts";

const PAGE = 48;

type HideAction = "dismiss" | "snooze";

function RepoIcon() {
  return (
    <svg
      className="repo-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"
      />
    </svg>
  );
}

function TrendingCard({
  repo,
  onHide,
}: {
  repo: TrendingRepo;
  onHide: (repo: string, action: HideAction) => void;
}) {
  const [owner, name] = repo.repo.split("/");
  const press = (action: HideAction) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onHide(repo.repo, action);
  };
  return (
    <a
      className="card"
      href={`https://github.com/${repo.repo}`}
      target="_blank"
      rel="noreferrer"
    >
      <div
        className="card-hero"
        style={
          repo.languageColor
            ? ({ "--lang": repo.languageColor } as CSSProperties)
            : undefined
        }
      >
        <img
          src={`https://github.com/${owner}.png`}
          alt=""
          loading="lazy"
          width="96"
          height="96"
        />
      </div>
      <div className="card-body">
        <h3 className="card-title">
          <RepoIcon />
          <span className="card-name">
            <span className="muted">{owner} /</span> {name}
          </span>
        </h3>
        <p className="card-description">{repo.description}</p>
        <div className="card-footer">
          {repo.language && (
            <span className="card-language">
              <span
                className="dot"
                style={
                  repo.languageColor
                    ? { background: repo.languageColor }
                    : undefined
                }
              />
              {repo.language}
            </span>
          )}
          <span title="Total stars">★ {compact(repo.stars)}</span>
          <span title="Stars per day">↑{compact(repo.starsPerDay)}/day</span>
          <span className="card-actions">
            <button
              className="card-button"
              title="Hide this repository for 30 days"
              onClick={press("snooze")}
            >
              Snooze
            </button>
            <button
              className="card-button"
              title="Dismiss for good"
              aria-label="Dismiss for good"
              onClick={press("dismiss")}
            >
              ✕
            </button>
          </span>
        </div>
      </div>
    </a>
  );
}

/** Trending repositories across every followed period and language, minus the operator's stars and dismissals. */
export function TrendingView() {
  const [repos, setRepos] = useState<TrendingRepo[]>();
  const [error, setError] = useState<string>();
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

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

  const more = shown < (repos?.length ?? 0);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setShown((count) => count + PAGE);
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, shown]);

  async function hide(repo: string, action: HideAction) {
    try {
      await hideTrending(repo, action);
      setRepos((current) => current?.filter((r) => r.repo !== repo));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

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
      {!repos && !error && <p className="muted">Reading the trending pages…</p>}
      {repos && repos.length === 0 && (
        <p className="muted">Nothing new is trending.</p>
      )}
      {repos && repos.length > 0 && (
        <div className="card-grid">
          {repos.slice(0, shown).map((repo) => (
            <TrendingCard key={repo.repo} repo={repo} onHide={hide} />
          ))}
        </div>
      )}
      {more && <div ref={sentinel} className="sentinel" />}
    </section>
  );
}
