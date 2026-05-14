// Phase 5B — Debounced doc save + flushDocSave (Doc 18 §Save behaviour).
// Mocks the Tauri IPC layer so the store's debounce/flush logic is exercised
// in isolation.

import * as tauriCore from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushPendingDocSave, useWorkspaceStore } from '../stores/workspaceStore';

vi.mock('@tauri-apps/api/core');

describe('workspaceStore — debounced doc save (Doc 18)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(tauriCore.invoke).mockResolvedValue(undefined);
    useWorkspaceStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid keystrokes into a single save', () => {
    const { updateDocContent } = useWorkspaceStore.getState();
    updateDocContent('doc-1', 'a');
    updateDocContent('doc-1', 'ab');
    updateDocContent('doc-1', 'abc');

    // Nothing fired yet — still within the 1 s window.
    expect(tauriCore.invoke).not.toHaveBeenCalled();

    // After the debounce window elapses, exactly one save lands with the
    // most-recent content.
    vi.advanceTimersByTime(1000);
    expect(tauriCore.invoke).toHaveBeenCalledTimes(1);
    expect(tauriCore.invoke).toHaveBeenCalledWith('update_item_content', {
      itemId: 'doc-1',
      content: 'abc',
    });
  });

  it('does not fire when only one keystroke and timer not advanced', () => {
    useWorkspaceStore.getState().updateDocContent('doc-1', 'only-one');
    expect(tauriCore.invoke).not.toHaveBeenCalled();
  });

  it('flushPendingDocSave fires the pending save immediately and clears it', async () => {
    useWorkspaceStore.getState().updateDocContent('doc-2', 'hello world');
    expect(tauriCore.invoke).not.toHaveBeenCalled();

    await flushPendingDocSave();
    expect(tauriCore.invoke).toHaveBeenCalledTimes(1);
    expect(tauriCore.invoke).toHaveBeenCalledWith('update_item_content', {
      itemId: 'doc-2',
      content: 'hello world',
    });

    // After flush, the timer is cleared — advancing time must not refire.
    vi.advanceTimersByTime(5000);
    expect(tauriCore.invoke).toHaveBeenCalledTimes(1);
  });

  it('flushPendingDocSave is a no-op when nothing is pending', async () => {
    await flushPendingDocSave();
    expect(tauriCore.invoke).not.toHaveBeenCalled();
  });

  it('clear() cancels a pending debounced save', () => {
    useWorkspaceStore.getState().updateDocContent('doc-3', 'gone');
    useWorkspaceStore.getState().clear();
    vi.advanceTimersByTime(5000);
    expect(tauriCore.invoke).not.toHaveBeenCalled();
  });
});
