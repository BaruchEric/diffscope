// src/web/lib/fuzzy.ts
// Tiny fuzzy matcher: substring and acronym scoring.
// No external dependencies.

export function fuzzyScore(haystack: string, needle: string): number {
  if (needle === "") return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  // Exact substring: highest score.
  const idx = h.indexOf(n);
  if (idx !== -1) {
    // Earlier match = higher score. Shorter haystack = higher score.
    return 1000 - idx - (h.length - n.length) * 0.1;
  }

  // Acronym match: each needle char must match first char of a word
  // (run of non-whitespace after whitespace) in order.
  const words = h.split(/[\s/_-]+/).filter((w) => w.length > 0);
  let wi = 0;
  let ni = 0;
  while (ni < n.length && wi < words.length) {
    if (words[wi]!.startsWith(n[ni]!)) {
      ni++;
    }
    wi++;
  }
  if (ni === n.length) {
    return 500 - wi;
  }

  // Scattered match: each needle char appears in order.
  let hi = 0;
  let matched = 0;
  for (const c of n) {
    const found = h.indexOf(c, hi);
    if (found === -1) return -Infinity;
    hi = found + 1;
    matched++;
  }
  if (matched === n.length) return 100 - h.length * 0.01;
  return -Infinity;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (query === "") return items.slice();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(getText(item), query);
    if (score > -Infinity) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
