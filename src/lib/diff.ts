import type { DiffSpan } from '@/lib/types';

/**
 * Doc 17 §Diff Display. Word-level Longest Common Subsequence diff between the
 * original message content and the stitched revision.
 *
 * The rendered bubble shows the *revision* with changed regions highlighted,
 * so the returned spans always recombine to `revised` (`spans.join('')` ===
 * `revised`). Tokens present only in the original (deletions) are dropped —
 * there is no text in the revision to mark. Tokens are alternating runs of
 * word / non-word characters; adjacent spans of the same kind are merged so
 * each highlight is one contiguous region.
 */
export function diffWords(original: string, revised: string): DiffSpan[] {
  const a = tokenize(original);
  const b = tokenize(revised);

  // LCS table — rows over `a`, columns over `b`.
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: DiffSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'unchanged', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      // Token only in `a` — a deletion. Dropped: nothing to render in the
      // revision (the adjacent insertion, if any, carries the highlight).
      i += 1;
    } else {
      // Token only in `b` — an insertion.
      raw.push({ kind: 'changed', text: b[j] });
      j += 1;
    }
  }
  // Any trailing tokens only in `a` are deletions — dropped. Trailing tokens
  // only in `b` are insertions.
  while (j < n) {
    raw.push({ kind: 'changed', text: b[j] });
    j += 1;
  }

  return mergeSpans(raw);
}

/** Split into alternating word / non-word runs. `join('')` is lossless. */
function tokenize(text: string): string[] {
  const matches = text.match(/\w+|\W+/gu);
  return matches ?? [];
}

/** Collapse consecutive spans of the same kind into one. */
function mergeSpans(spans: DiffSpan[]): DiffSpan[] {
  const merged: DiffSpan[] = [];
  for (const span of spans) {
    if (span.text.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && last.kind === span.kind) {
      last.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
