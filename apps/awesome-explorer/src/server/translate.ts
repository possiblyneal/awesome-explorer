// English translations of card text from MyMemory's free API, which detects
// the source language itself and answers text that is already English with
// a 403 "PLEASE SELECT TWO DISTINCT LANGUAGES".

const API = "https://api.mymemory.translated.net/get";

/**
 * `text` in English, unchanged when it already is. `email` raises the daily
 * quota from 5,000 to 50,000 characters.
 */
export async function translateToEnglish(
  text: string,
  email?: string,
): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: "autodetect|en" });
  if (email) params.set("de", email);
  const response = await fetch(`${API}?${params}`, {
    headers: { "user-agent": "awesome-explorer" },
  });
  if (!response.ok)
    throw new Error(`MyMemory: ${response.status} ${response.statusText}`);
  const body = (await response.json()) as {
    responseStatus: number | string;
    responseDetails: string;
    responseData: { translatedText: string };
  };
  if (/distinct languages/i.test(body.responseDetails)) return text;
  if (Number(body.responseStatus) !== 200)
    throw new Error(`MyMemory: ${body.responseStatus} ${body.responseDetails}`);
  return body.responseData.translatedText;
}
