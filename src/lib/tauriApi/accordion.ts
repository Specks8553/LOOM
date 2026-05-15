import { invoke } from '@tauri-apps/api/core';

import type { AccordionState, Checkpoint } from '@/lib/types';

// --- Doc 16 §Backend API. Typed wrappers for `commands/accordion.rs`. ---

/** Aggregate read: checkpoints + closed segments for the story. */
export async function getAccordionState(storyId: string): Promise<AccordionState> {
  return invoke<AccordionState>('get_accordion_state', { storyId });
}

/** Insert a user checkpoint anchored to an AI bubble. Closes the open segment
 *  (or splits a closed one — dropping its summary). Marks story cache stale
 *  if any active cache exists. */
export async function createCheckpoint(
  storyId: string,
  afterMessageId: string,
  name: string,
): Promise<Checkpoint> {
  return invoke<Checkpoint>('create_checkpoint', { storyId, afterMessageId, name });
}

/** Display-only rename — never a cache-stale trigger. */
export async function renameCheckpoint(checkpointId: string, name: string): Promise<void> {
  return invoke('rename_checkpoint', { checkpointId, name });
}

/** Delete a user checkpoint. Merges neighbour segments (or re-opens the tail
 *  when deleting the most recent). The start sentinel cannot be deleted. */
export async function deleteCheckpoint(checkpointId: string): Promise<void> {
  return invoke('delete_checkpoint', { checkpointId });
}

/** Persist a manually edited summary. Clears `is_stale`. Cache stale iff the
 *  segment overlaps the cached prefix. */
export async function updateSegmentSummary(segmentId: string, summary: string): Promise<void> {
  return invoke('update_segment_summary', { segmentId, summary });
}

/** UI-only collapse toggle. Never a cache-stale trigger. */
export async function setSegmentCollapsed(segmentId: string, collapsed: boolean): Promise<void> {
  return invoke('set_segment_collapsed', { segmentId, collapsed });
}

/** API-level toggle: when false, the segment's full messages re-enter history
 *  even when collapsed. Cache stale iff the segment overlaps the cached
 *  prefix. */
export async function setSegmentUseSummary(segmentId: string, useSummary: boolean): Promise<void> {
  return invoke('set_segment_use_summary', { segmentId, useSummary });
}

/** Reset to newly-created shape: drops `summary`, `summarised_at`, `is_stale`,
 *  forces `use_summary = true`, `is_collapsed = false`. */
export async function clearSegmentSummary(segmentId: string): Promise<void> {
  return invoke('clear_segment_summary', { segmentId });
}

/** Non-streaming Gemini summarise. Returns the new summary on success,
 *  `null` when the user cancelled (silent — Doc 16 §Cancellation). */
export async function summariseSegment(segmentId: string): Promise<string | null> {
  return invoke<string | null>('summarise_segment', { segmentId });
}
