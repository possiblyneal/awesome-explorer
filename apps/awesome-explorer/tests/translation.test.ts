import { describe, expect, it } from "vitest";
import { mayNeedTranslation } from "../src/shared/translation.ts";

describe("mayNeedTranslation", () => {
  it.each([
    ["一分钟搭建影视站", true],
    ["Ferramenta de código aberto", true],
    ["Инструмент", true],
    ["The open source coding agent.", false],
    ["🚀 Fast — 100% typed", false],
  ])("%s → %s", (text, expected) => {
    expect(mayNeedTranslation(text)).toBe(expected);
  });
});
