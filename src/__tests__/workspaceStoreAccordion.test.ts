// Accordion store actions (Doc 16 §Backend API). Mocks the Tauri IPC layer
// so the store's create/rename/delete/summarise actions can be exercised
// without a backend.

import * as tauriCore from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '../stores/workspaceStore';

import type { AccordionState, Checkpoint } from '@/lib/types';

vi.mock('@tauri-apps/api/core');

function mockAccordionState(state: AccordionState): void {
  vi.mocked(tauriCore.invoke).mockImplementation((cmd: string) => {
    if (cmd === 'get_accordion_state') return Promise.resolve(state);
    return Promise.resolve(undefined);
  });
}

const SENTINEL: Checkpoint = {
  id: 'cp-start',
  story_id: 'story-1',
  after_message_id: null,
  name: 'Chapter 1',
  is_start: true,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
};

describe('workspaceStore — accordion actions (Doc 16)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkspaceStore.getState().clear();
    useWorkspaceStore.setState({ activeStoryId: 'story-1' });
  });

  it('loadAccordionState pulls checkpoints + segments from the backend', async () => {
    mockAccordionState({ checkpoints: [SENTINEL], segments: [] });
    await useWorkspaceStore.getState().loadAccordionState();
    expect(useWorkspaceStore.getState().checkpoints).toEqual([SENTINEL]);
    expect(useWorkspaceStore.getState().segments).toEqual([]);
  });

  it('createCheckpoint invokes the backend with the story id and reloads state', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    vi.mocked(tauriCore.invoke).mockImplementation((cmd: string, args?: unknown) => {
      calls.push({ cmd, args });
      if (cmd === 'get_accordion_state')
        return Promise.resolve({ checkpoints: [SENTINEL], segments: [] });
      if (cmd === 'create_checkpoint')
        return Promise.resolve({ ...SENTINEL, id: 'cp-2', is_start: false });
      return Promise.resolve(undefined);
    });
    await useWorkspaceStore.getState().createCheckpoint('msg-x', 'Chapter 2');
    const createCall = calls.find((c) => c.cmd === 'create_checkpoint');
    expect(createCall).toBeDefined();
    expect(createCall?.args).toEqual({
      storyId: 'story-1',
      afterMessageId: 'msg-x',
      name: 'Chapter 2',
    });
    // Followed by a refetch.
    expect(calls.some((c) => c.cmd === 'get_accordion_state')).toBe(true);
  });

  it('summariseSegment tracks the in-flight id and clears it on resolve', async () => {
    let releaseSummarise: (text: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      releaseSummarise = resolve;
    });
    vi.mocked(tauriCore.invoke).mockImplementation((cmd: string) => {
      if (cmd === 'summarise_segment') return pending;
      if (cmd === 'get_accordion_state')
        return Promise.resolve({ checkpoints: [SENTINEL], segments: [] });
      return Promise.resolve(undefined);
    });

    const promise = useWorkspaceStore.getState().summariseSegment('seg-1');
    // While in flight, the spinner set carries the segment id.
    expect(useWorkspaceStore.getState().summarisingSegmentIds.has('seg-1')).toBe(true);

    releaseSummarise('A summary.');
    const result = await promise;
    expect(result).toBe('A summary.');
    expect(useWorkspaceStore.getState().summarisingSegmentIds.has('seg-1')).toBe(false);
  });

  it('summariseSegment surfaces the error and clears in-flight state on rejection', async () => {
    vi.mocked(tauriCore.invoke).mockImplementation((cmd: string) => {
      if (cmd === 'summarise_segment') return Promise.reject(new Error('boom'));
      return Promise.resolve(undefined);
    });
    // CQ-11: summarise now routes failures through surfaceError and resolves
    // null (AccordionBanner does not catch — swallowing avoids an unhandled
    // rejection). The in-flight id and the global isGenerating flag both clear.
    const result = await useWorkspaceStore.getState().summariseSegment('seg-1');
    expect(result).toBeNull();
    expect(useWorkspaceStore.getState().summarisingSegmentIds.has('seg-1')).toBe(false);
    expect(useWorkspaceStore.getState().isGenerating).toBe(false);
  });

  it('clear() drops accordion state', () => {
    useWorkspaceStore.setState({
      checkpoints: [SENTINEL],
      segments: [],
      summarisingSegmentIds: new Set(['seg-1']),
    });
    useWorkspaceStore.getState().clear();
    expect(useWorkspaceStore.getState().checkpoints).toEqual([]);
    expect(useWorkspaceStore.getState().segments).toEqual([]);
    expect(useWorkspaceStore.getState().summarisingSegmentIds.size).toBe(0);
  });
});
