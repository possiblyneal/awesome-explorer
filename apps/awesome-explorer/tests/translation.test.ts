import { afterEach, describe, expect, it, vi } from "vitest";
import { translateToEnglish } from "../src/server/translate.ts";
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

describe("translateToEnglish", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails when the daily quota is used up rather than answer the warning", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        responseStatus: 200,
        responseDetails: "",
        quotaFinished: true,
        responseData: {
          translatedText:
            "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY",
        },
      }),
    );
    await expect(translateToEnglish("一分钟搭建影视站")).rejects.toThrow(
      /quota/,
    );
  });
});
