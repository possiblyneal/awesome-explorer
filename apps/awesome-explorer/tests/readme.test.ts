import { describe, expect, it } from "vitest";
import {
  countOutboundLinks,
  parseAwesomeList,
  repoFromUrl,
} from "../src/server/readme.ts";

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
    "> A curated list. Inspired by [awesome-python](https://github.com/vinta/awesome-python).",
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
    "> **[Eta](https://github.com/acme/eta)** <kbd>★ 9</kbd><br>Quoted.",
    "",
    "Name | Description",
    "--- | ---",
    "[Theta](https://github.com/acme/theta) | A pipeless row | [MIT](https://mit.edu)",
    "",
    "Prose after the table, with [Iota](https://github.com/acme/iota) | a pipe.",
    "",
    "```",
    "- [Fenced](https://github.com/acme/fenced) - ignored",
    "```",
  ].join("\n");

  const entries = parseAwesomeList(readme, "me/awesome-things");

  it("finds list items, quoted items, and table rows, in order, once each, skipping quoted prose", () => {
    expect(entries.map((e) => e.repo)).toEqual([
      "acme/alpha",
      "acme/beta",
      "acme/zeta",
      "acme/gamma",
      "acme/delta",
      "acme/epsilon",
      "acme/eta",
      "acme/theta",
    ]);
  });

  it("takes a table row's description from the cell after its link", () => {
    expect(entries[5]!.description).toBe("table row");
    expect(entries[7]!.description).toBe("A pipeless row");
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

describe("countOutboundLinks", () => {
  it("counts distinct targets in any position, skipping images, image links, and the repository itself", () => {
    const markdown = [
      "[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)",
      "> **[japicmp](https://github.com/siom79/japicmp)** compares JARs.",
      "[Cyber](https://github.com/a/cyber) | table row without a pipe first",
      '<a href="https://example.com/tool">Tool</a> and <https://example.org>',
      "- [Again](https://github.com/a/cyber/) and [Own](https://github.com/Acme/List#readme)",
      "[Own file](https://github.com/acme/list/blob/main/a.md) and [Sibling](https://github.com/acme/list-tools)",
    ].join("\n");
    expect(countOutboundLinks(markdown, "acme/list")).toBe(5);
  });
});
