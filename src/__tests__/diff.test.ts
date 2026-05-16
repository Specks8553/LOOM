import { describe, expect, it } from 'vitest';

import { diffWords } from '@/lib/diff';

/** Doc 17 §Diff Display — word-level LCS diff between original and revision. */
describe('diffWords', () => {
  it('returns a single unchanged span when the texts are identical', () => {
    const spans = diffWords('the quick brown fox', 'the quick brown fox');
    expect(spans).toEqual([{ kind: 'unchanged', text: 'the quick brown fox' }]);
  });

  it('marks a replaced word as a changed span', () => {
    const spans = diffWords('the quick brown fox', 'the quick red fox');
    const text = spans.map((s) => s.text).join('');
    expect(text).toBe('the quick red fox');
    expect(spans.some((s) => s.kind === 'changed' && s.text.includes('red'))).toBe(true);
    expect(spans[0]).toEqual({ kind: 'unchanged', text: 'the quick ' });
  });

  it('recombines to the revision — joined spans equal the revised text', () => {
    const original = 'A short sentence.';
    const revised = 'A much longer, rewritten sentence here.';
    const spans = diffWords(original, revised);
    expect(spans.map((s) => s.text).join('')).toBe(revised);
    expect(spans.every((s) => s.text.length > 0)).toBe(true);
  });

  it('drops deleted tokens — they are not present in the revision', () => {
    const spans = diffWords('keep this gone', 'keep this ');
    expect(spans.map((s) => s.text).join('')).toBe('keep this ');
    expect(spans.some((s) => s.text.includes('gone'))).toBe(false);
  });

  it('handles empty original (pure insertion)', () => {
    const spans = diffWords('', 'brand new text');
    expect(spans).toEqual([{ kind: 'changed', text: 'brand new text' }]);
  });

  it('merges a deletion + insertion at the same site into one changed span', () => {
    const spans = diffWords('one two three', 'one ALPHA three');
    const changed = spans.filter((s) => s.kind === 'changed');
    expect(changed).toHaveLength(1);
    expect(spans.map((s) => s.text).join('')).toBe('one ALPHA three');
  });
});
