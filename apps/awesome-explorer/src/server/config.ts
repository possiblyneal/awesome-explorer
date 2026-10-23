import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface Config {
  host: string;
  port: number;
  production: boolean;
  githubToken: string;
  databasePath: string;
  /** Sent to MyMemory, which raises its daily quota from 5,000 to 50,000 characters for it. */
  translationEmail: string | undefined;
}

/** The token GitHub CLI is signed in with, so a machine with `gh` needs no extra setup. */
async function ghToken(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function loadConfig(): Promise<Config> {
  const githubToken = process.env.GITHUB_TOKEN || (await ghToken());
  if (!githubToken) {
    throw new Error(
      "No GitHub token: set GITHUB_TOKEN or sign in with `gh auth login`.",
    );
  }
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4321),
    production: process.env.NODE_ENV === "production",
    githubToken,
    databasePath: `${import.meta.dirname}/../../state/cache.db`,
    translationEmail: process.env.MYMEMORY_EMAIL || undefined,
  };
}
