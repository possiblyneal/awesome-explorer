// A thin fetch client for the parts of GitHub's REST and GraphQL APIs the
// explorer reads. It classifies failures so callers can tell a rate limit
// (wait and retry) from a request GitHub refused (do not retry as-is).

const API = "https://api.github.com";

export class RateLimitError extends Error {
  resetAt: Date;

  constructor(resetAt: Date) {
    super(`GitHub rate limit reached; resets at ${resetAt.toISOString()}`);
    this.resetAt = resetAt;
  }
}

export class GitHubError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface GraphQLResponse<T> {
  data: T | null;
  errors: { type?: string; message: string; path?: (string | number)[] }[];
}

export interface SearchItem {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  topics?: string[];
}

/** Stars gained in one week, newest week first; `days[0]` is the week's Sunday. */
export interface StarWeek {
  week: number;
  total: number;
  days: number[];
}

function resetTime(headers: Headers): Date {
  const retryAfter = Number(headers.get("retry-after"));
  if (retryAfter > 0) return new Date(Date.now() + retryAfter * 1000);
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (reset > 0) return new Date(reset * 1000);
  return new Date(Date.now() + 60_000);
}

export class GitHub {
  #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#token}`,
        "user-agent": "awesome-explorer",
        "x-github-api-version": "2022-11-28",
        ...init.headers,
      },
    });
    if (response.ok || response.status === 404) return response;
    const limited =
      response.headers.get("x-ratelimit-remaining") === "0" ||
      response.headers.has("retry-after");
    if ((response.status === 403 || response.status === 429) && limited) {
      throw new RateLimitError(resetTime(response.headers));
    }
    const body = (await response.text()).slice(0, 300);
    // A secondary limit names itself only in the body, and GitHub asks for at
    // least a minute's wait when it sends no retry-after.
    if (
      (response.status === 403 || response.status === 429) &&
      /secondary rate limit/i.test(body)
    ) {
      throw new RateLimitError(new Date(Date.now() + 60_000));
    }
    throw new GitHubError(
      response.status,
      `GitHub ${path}: ${response.status} ${body}`,
    );
  }

  /** The repository's README as Markdown, or null when it has none or does not exist. */
  async readme(repo: string): Promise<string | null> {
    const response = await this.#request(`/repos/${repo}/readme`, {
      headers: { accept: "application/vnd.github.raw" },
    });
    return response.status === 404 ? null : response.text();
  }

  async searchRepositories(query: string): Promise<SearchItem[]> {
    const params = new URLSearchParams({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: "50",
    });
    const response = await this.#request(`/search/repositories?${params}`);
    if (response.status === 404) return [];
    const body = (await response.json()) as { items: SearchItem[] };
    return body.items;
  }

  /**
   * Weekly star counts, newest first, or null when the repository does not
   * exist. GitHub restricted the stargazer listings to collaborators in 2026;
   * this aggregate is what remains public.
   */
  async starHistory(repo: string, weeks: number): Promise<StarWeek[] | null> {
    const response = await this.#request(
      `/repos/${repo}/stargazers/history?per_page=${weeks}`,
    );
    return response.status === 404
      ? null
      : ((await response.json()) as StarWeek[]);
  }

  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    const response = await this.#request("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as Partial<GraphQLResponse<T>>;
    const errors = body.errors ?? [];
    if (errors.some((error) => error.type === "RATE_LIMITED")) {
      throw new RateLimitError(resetTime(response.headers));
    }
    if (!body.data) {
      throw new GitHubError(
        response.status,
        `GitHub GraphQL: ${errors[0]?.message ?? "no data"}`,
      );
    }
    return { data: body.data, errors };
  }
}
