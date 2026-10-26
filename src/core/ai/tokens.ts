/** Rough token count: ~4 characters per token for Latin text, about one per character for CJK. Only used for budgeting, so close is enough. */
export function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) n += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.27;
  return Math.ceil(n);
}
