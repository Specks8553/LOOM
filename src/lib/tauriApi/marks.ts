import { invoke } from '@tauri-apps/api/core';

import type { ImportantMark } from '@/lib/types';

// --- Doc 30 §10 / Doc 07 §marks. Typed wrappers for `commands/marks.rs`. ---

/** All marks for a story (both roles, including orphaned). Loaded alongside
 *  messages on story open. */
export async function listMarks(storyId: string): Promise<ImportantMark[]> {
  return invoke<ImportantMark[]>('list_marks', { storyId });
}

/** Create a mark on a story bubble. `charStart`/`charEnd` are offsets into the
 *  host message `content` (AI bubbles only — `null` for user bubbles, where no
 *  single-string mapping exists). `quotedText` is the verbatim, authoritative
 *  passage. Stales the containing closed accordion segment if any. */
export async function addMark(
  messageId: string,
  quotedText: string,
  charStart: number | null,
  charEnd: number | null,
  note: string | null,
): Promise<ImportantMark> {
  return invoke<ImportantMark>('add_mark', {
    messageId,
    quotedText,
    charStart,
    charEnd,
    note,
  });
}

/** Delete a mark. Stales the containing closed segment if any. */
export async function removeMark(markId: string): Promise<void> {
  return invoke('remove_mark', { markId });
}

/** Edit a mark's note (pass `null` to clear). The note rides the summary
 *  manifest, so a change inside a closed segment stales it. */
export async function updateMarkNote(markId: string, note: string | null): Promise<void> {
  return invoke('update_mark_note', { markId, note });
}
