/**
 * Text normalization for untrusted listing titles.
 *
 * Titles come from retailers, so they may contain odd Unicode, zero-width
 * characters, HTML, or text written to look like instructions. We only ever
 * *search* them with fixed regular expressions; we never execute, evaluate or
 * follow anything in them. Length is capped before any regex runs, and every
 * pattern below is simple (no nested quantifiers), so matching is linear-time.
 */

const MAX_LEN = 400

export function normalizeText(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .slice(0, MAX_LEN * 2)
    .normalize('NFKC') // folds full-width and other look-alike forms
    .replace(/[​-‏⁠﻿­]/g, '') // zero-width / soft hyphen
    .replace(/[‐-―−]/g, '-') // dash variants
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN)
}

export function has(t: string, re: RegExp): boolean {
  return re.test(t)
}

/** Capacity in terabytes parsed from "2TB", "2 TB", "2000GB". Ignores MB/s speeds. */
export function capacities(t: string): string[] {
  const out = new Set<string>()
  for (const m of t.matchAll(/(\d{1,4}(?:\.\d{1,2})?)\s?(tb|gb)\b/g)) {
    const n = parseFloat(m[1])
    const gb = m[2] === 'tb' ? n * 1000 : n
    if (!Number.isFinite(gb) || gb <= 0) continue
    out.add(gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000}TB` : `${gb}GB`)
  }
  return [...out]
}
