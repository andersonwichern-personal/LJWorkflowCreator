/**
 * Hostile-input sanitization shared by the /api functions.
 *
 * Everything arriving in a request body is author-controlled and UNTRUSTED
 * (docs/parser-ai-backend-contract.md): text is NFC-normalized with control
 * characters (C0/C1 except newline/tab) and zero-width/bidi-override code
 * points stripped, and anything placed into a prompt goes through the donor
 * route's `cleanPromptText` + `limitItems` compaction so a hostile vocabulary
 * label cannot smuggle instructions or blow up the prompt.
 *
 * The character classes are built from numeric code points on purpose: the
 * stripped characters are exactly the ones that make source files and diffs
 * lie, so they must not appear literally in this file either.
 */

function charClass(ranges: Array<[number, number] | number>): RegExp {
  const cls = ranges
    .map((r) =>
      typeof r === "number"
        ? String.fromCharCode(r)
        : `${String.fromCharCode(r[0])}-${String.fromCharCode(r[1])}`
    )
    .join("");
  return new RegExp(`[${cls}]`, "g");
}

/** C0/C1 control characters except tab (0x09) and newline (0x0A). */
const CONTROL_CHARS = charClass([
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
]);

/** Zero-width/joiner chars, bidi marks + overrides + isolates, BOM. */
const INVISIBLE_CHARS = charClass([
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings + overrides
  [0x2060, 0x2064], // word joiner + invisible operators
  [0x2066, 0x2069], // bidi isolates
  0xfeff, // BOM / zero-width no-break space
]);

/**
 * NFC-normalize and strip control characters (C0/C1 except newline and tab),
 * zero-width characters, and bidi-override code points.
 */
export function stripHostileCharacters(value: string): string {
  return value.normalize("NFC").replace(CONTROL_CHARS, "").replace(INVISIBLE_CHARS, "");
}

/**
 * Donor route's prompt-text cleaner: tenant vocabulary is DATA — remove the
 * characters most useful for breaking out of a delimited snapshot.
 */
export function cleanPromptText(value: string): string {
  return value
    .replace(/[`$<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Donor route's list compaction — prompts carry at most 20 items per list. */
export function limitItems<T>(items: T[], limit = 20): T[] {
  return items.slice(0, limit);
}
