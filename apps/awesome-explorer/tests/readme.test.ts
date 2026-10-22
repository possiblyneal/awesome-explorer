import { describe, expect, it } from "vitest";
import { parseAwesomeList, repoFromUrl } from "../src/server/readme.ts";

describe("repoFromUrl", () => {
  it("reads owner and name from repository URLs", () => {
    expect(
      repoFromUrl("https://github.com/sindresorhus/awesome-nodejs#readme"),
    ).toBe("sindresorhus/awesome-nodejs");
    expect(repoFromUrl("https://www.github.com/a/b.git")).toBe("a/b");
    expect(repoFromUrl("https://github.com/a/b/tree/main/docs")).toBe("a/b");
  });

  it("rejects GitHub pages that are not repositories", () => {
    expect(repoFromUrl("https://github.com/topics/awesome")).toBeNull();
    expect(repoFromUrl("https://github.com/sponsors/someone")).toBeNull();
    expect(repoFromUrl("https://github.com/someone")).toBeNull();
    expect(repoFromUrl("https://gitlab.com/a/b")).toBeNull();
  });
});

describe("parseAwesomeList", () => {
  const readme = [
    "# Awesome Things [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)",
    "",
    "Built by [me](https://github.com/me/awesome-things) with help from https://github.com/x/prose.",
    "",
    "## Contents",
    "- [Tools](#tools)",
    "",
    "## Tools",
    "",
    "- [**Alpha**](https://github.com/acme/alpha) - Does `alpha` things, see [docs](https://alpha.dev).",
    "* [Beta](https://github.com/acme/beta.git): A beta.",
    "- [Alpha again](https://github.com/ACME/Alpha) - Duplicate.",
    "- [Self](https://github.com/me/awesome-things/blob/main/contributing.md)",
    "- [Zeta](https://github.com/acme/zeta) - Nested <<b>b>tags</b> stripped.",
    "",
    "### Sub section",
    "",
    "1. [Gamma](https://github.com/acme/gamma) - Wraps [delta](https://github.com/acme/delta).",
    '| <a href="https://github.com/acme/epsilon">Epsilon</a> | table row |',
    "",
    "```",
    "- [Fenced](https://github.com/acme/fenced) - ignored",
    "```",
  ].join("\n");

  const entries = parseAwesomeList(readme, "me/awesome-things");

  it("finds list items and table rows, in order, once each", () => {
    expect(entries.map((e) => e.repo)).toEqual([
      "acme/alpha",
      "acme/beta",
      "acme/zeta",
      "acme/gamma",
      "acme/delta",
      "acme/epsilon",
    ]);
  });

  it("records the section heading and plain-text description", () => {
    expect(entries[0]).toEqual({
      repo: "acme/alpha",
      name: "Alpha",
      section: "Tools",
      description: "Does alpha things, see docs.",
    });
    expect(entries[1]!.description).toBe("A beta.");
    expect(entries[2]!.description).toBe("Nested tags stripped.");
    expect(entries[3]!.section).toBe("Sub section");
  });

  it("gives only the line's first repository the description", () => {
    expect(entries[3]!.description).toBe("Wraps delta.");
    expect(entries[4]!.description).toBe("");
  });
});
