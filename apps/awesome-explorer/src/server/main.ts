// One process serves the JSON API and the UI: through Vite's dev middleware in
// development, and from the built dist/web in production.

import express, { type ErrorRequestHandler } from "express";
import { loadConfig } from "./config.ts";
import { Explorer, NotFoundError } from "./explorer.ts";
import { GitHub, RateLimitError } from "./github.ts";
import { Store } from "./store.ts";

const NAME = /^[\w.-]+$/;
const unitRoot = `${import.meta.dirname}/../..`;

const config = await loadConfig();
const explorer = new Explorer(
  new GitHub(config.githubToken),
  new Store(config.databasePath),
);
const app = express();

app.get("/api/lists/:owner/:name", async (req, res) => {
  const { owner, name } = req.params;
  if (!NAME.test(owner) || !NAME.test(name)) {
    res.status(400).json({ error: "expected a repository as owner/name" });
    return;
  }
  res.json(await explorer.list(`${owner}/${name}`));
});

app.get("/api/stars", async (_req, res) => {
  res.json(await explorer.stars());
});

app.get("/api/trending", async (_req, res) => {
  res.json(await explorer.trending());
});

app.post("/api/trending/:owner/:name/:action", (req, res) => {
  const { owner, name, action } = req.params;
  if (!NAME.test(owner) || !NAME.test(name)) {
    res.status(400).json({ error: "expected a repository as owner/name" });
    return;
  }
  if (action === "dismiss") explorer.dismiss(`${owner}/${name}`);
  else if (action === "snooze") explorer.snooze(`${owner}/${name}`);
  else {
    res.status(404).json({ error: "expected dismiss or snooze" });
    return;
  }
  res.status(204).end();
});

app.get("/api/discover", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  res.json(await explorer.discover(query));
});

if (config.production) {
  app.use(express.static(`${unitRoot}/dist/web`));
} else {
  const { createServer } = await import("vite");
  // The default "bundle" loader imports a temp copy of the config and deletes
  // it, which node --watch reads as a change and restarts forever.
  const vite = await createServer({
    configFile: `${unitRoot}/vite.config.ts`,
    configLoader: "native",
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const handleError: ErrorRequestHandler = (error: Error, _req, res, _next) => {
  const status =
    error instanceof NotFoundError
      ? 404
      : error instanceof RateLimitError
        ? 429
        : 502;
  if (status === 502) console.error(error);
  res.status(status).json({ error: error.message });
};
app.use(handleError);

app.listen(config.port, config.host, () => {
  console.log(
    `awesome-explorer listening on http://${config.host}:${config.port}`,
  );
});
