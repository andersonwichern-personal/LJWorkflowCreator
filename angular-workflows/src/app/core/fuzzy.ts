/**
 * PORTED VERBATIM from the Vercel track: lib/fuzzy.ts @ 9894904.
 * This file is the shared rule-core contract between the two tracks
 * (see docs/agent/task.md 'Two-track doctrine'). Semantic changes must
 * land on both tracks. Keep framework-free: no Angular imports here.
 */
/**
 * Tiny fuzzy matcher for parser slot suggestions and the (future) rule linter
 * (hardening plan §2.5). No dependencies by design.
 */

/** Levenshtein distance, plain DP. Small inputs only (names, option labels). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Rank options against an input: exact → prefix → substring → edit distance ≤ 2
 * (edit distance only for inputs ≥ 4 chars, so "Wal" doesn't match everything).
 * Case-insensitive; returns at most `max` original-cased options.
 */
export function fuzzyMatches(input: string, options: string[], max = 3): string[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];

  const scored: { option: string; score: number }[] = [];
  for (const option of options) {
    const o = option.toLowerCase();
    if (o === q) scored.push({ option, score: 0 });
    else if (o.startsWith(q) || q.startsWith(o)) scored.push({ option, score: 1 });
    else if (o.includes(q) || q.includes(o)) scored.push({ option, score: 2 });
    else if (q.length >= 4 && levenshtein(q, o) <= 2) scored.push({ option, score: 3 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((s) => s.option);
}
