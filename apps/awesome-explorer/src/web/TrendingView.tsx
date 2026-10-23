import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, RefObject } from "react";
import type { TrendingRepo } from "../shared/types.ts";
import {
  fetchTrending,
  hideTrending,
  restoreTrending,
  translate,
} from "./api.ts";
import { mayNeedTranslation } from "../shared/translation.ts";
import { compact } from "./format.ts";

const PAGE = 48;

type HideAction = "dismiss" | "snooze";

const UNDO_FOR = 5000;

/** The latest hide, kept so undo can put its card back where it was. */
interface Hidden {
  card: TrendingRepo;
  index: number;
  action: HideAction;
}

/** `card` back at `index`, or last when the list has since shrunk. */
function insert(repos: TrendingRepo[], index: number, card: TrendingRepo) {
  return repos.toSpliced(Math.min(index, repos.length), 0, card);
}

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

/**
 * `text` in English once the card it sits on (`card`) first comes on screen;
 * the original until then, and for good if translation fails.
 */
function useEnglish(text: string | null, card: RefObject<HTMLElement | null>) {
  const [english, setEnglish] = useState<string>();
  useEffect(() => {
    const element = card.current;
    if (!text || !element || !mayNeedTranslation(text)) return;
    let live = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      translate(text)
        .then((result) => live && setEnglish(result))
        .catch(() => {});
    });
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [text, card]);
  return english ?? text;
}

function TrendingCard({
  repo,
  onHide,
}: {
  repo: TrendingRepo;
  onHide: (repo: string, action: HideAction) => void;
}) {
  const [owner, name] = repo.repo.split("/");
  const [imageBroken, setImageBroken] = useState(false);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const description = useEnglish(repo.description, cardRef);
  const press = (action: HideAction) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onHide(repo.repo, action);
  };
  return (
    <a
      ref={cardRef}
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
        {repo.image && !imageBroken ? (
          <img
            className="card-social"
            src={repo.image}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
          />
        ) : (
          <img
            src={`https://github.com/${owner}.png`}
            alt=""
            loading="lazy"
            width="96"
            height="96"
          />
        )}
      </div>
      <div className="card-body">
        <h3 className="card-title">
          <RepoIcon />
          <span className="card-name">
            <span className="muted">{owner} /</span> {name}
          </span>
        </h3>
        <p
          className="card-description"
          title={
            description !== repo.description
              ? (repo.description ?? undefined)
              : undefined
          }
        >
          {description}
        </p>
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
          <span title="Stars per day over the last 7 days">
            ↑{compact(repo.starsPerDay)}/day
          </span>
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
  const [hidden, setHidden] = useState<Hidden>();
  const sentinel = useRef<HTMLDivElement>(null);
  const undoTimer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

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

  // Both act on the list at the click, before the request, so a card's index
  // always counts only the cards on screen.
  async function hide(repo: string, action: HideAction) {
    const index = repos?.findIndex((r) => r.repo === repo) ?? -1;
    const card = repos?.[index];
    if (!card) return;
    setError(undefined);
    setRepos((current) => current?.filter((r) => r.repo !== repo));
    setHidden({ card, index, action });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setHidden(undefined), UNDO_FOR);
    try {
      await hideTrending(repo, action);
    } catch (reason) {
      // An undo may already have put the card back, and a later hide owns
      // whatever bar is showing now.
      setRepos((current) =>
        current && !current.some((r) => r.repo === repo)
          ? insert(current, index, card)
          : current,
      );
      setHidden((shown) => (shown?.card.repo === repo ? undefined : shown));
      setError((reason as Error).message);
    }
  }

  async function undo() {
    if (!hidden) return;
    const { card, index } = hidden;
    window.clearTimeout(undoTimer.current);
    setHidden(undefined);
    setError(undefined);
    setRepos((current) => current && insert(current, index, card));
    try {
      await restoreTrending(card.repo);
    } catch (reason) {
      setRepos((current) => current?.filter((r) => r.repo !== card.repo));
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
      {hidden && (
        <div className="undo-bar" role="status">
          <span>
            {hidden.action === "dismiss" ? "Dismissed" : "Snoozed"}{" "}
            {hidden.card.repo}
          </span>
          <button onClick={undo}>Undo</button>
        </div>
      )}
    </section>
  );
}
