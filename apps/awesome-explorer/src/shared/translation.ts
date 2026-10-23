/**
 * Whether `text` has a letter outside A–Z, the only sign of another language
 * cheap enough to check on every card. English with no accents never leaves
 * the server, which keeps MyMemory's daily quota for text that needs it.
 */
export function mayNeedTranslation(text: string): boolean {
  return /(?![A-Za-z])\p{L}/u.test(text);
}
