import { useEffect, useState, type FormEvent } from "react";
import { INDEX_LIST } from "../shared/index-list.ts";
import { DiscoverView } from "./DiscoverView.tsx";
import { listHref } from "./format.ts";
import { ListView } from "./ListView.tsx";

const REPO = /^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

type Route =
  | { page: "home" }
  | { page: "list"; repo: string }
  | { page: "search"; query: string };

function parseRoute(hash: string): Route {
  const list = /^#\/list\/([\w.-]+\/[\w.-]+)/.exec(hash);
  if (list) return { page: "list", repo: list[1]! };
  const search = /^#\/search\/(.*)$/.exec(hash);
  if (search) return { page: "search", query: decodeURIComponent(search[1]!) };
  return { page: "home" };
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

function SearchBox() {
  const [text, setText] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const repo = REPO.exec(value)?.[1];
    location.hash = repo
      ? listHref(repo)
      : `#/search/${encodeURIComponent(value)}`;
  }
  return (
    <form className="search" onSubmit={submit}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search awesome lists, or open owner/repo"
        aria-label="Search awesome lists or open a repository"
      />
    </form>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <header>
        <a className="brand" href="#/">
          Awesome Explorer
        </a>
        <SearchBox />
      </header>
      <main>
        {route.page === "list" && (
          <ListView key={route.repo} repo={route.repo} />
        )}
        {route.page === "search" && (
          <DiscoverView key={route.query} query={route.query} />
        )}
        {route.page === "home" && (
          <>
            <DiscoverView query="" />
            <ListView repo={INDEX_LIST} />
          </>
        )}
      </main>
    </>
  );
}
