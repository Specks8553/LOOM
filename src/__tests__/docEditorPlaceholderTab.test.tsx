// Phase 5B — Tab placeholder navigation (Doc 18 §Tab placeholder navigation).
// Verifies regex + cursor math: Tab selects next `{{...}}`, Shift+Tab the
// previous, both wrap; Tab inserts two spaces when no placeholders exist.

import * as tauriCore from '@tauri-apps/api/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { Toaster } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocEditor } from '../components/theater/DocEditor';
import { useVaultStore } from '../stores/vaultStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

import type { VaultItemMeta } from '../lib/types';

vi.mock('@tauri-apps/api/core');

function makeDoc(id: string): VaultItemMeta {
  return {
    id,
    parent_id: null,
    item_type: 'SourceDocument',
    item_subtype: null,
    name: 'Test doc',
    description: null,
    sort_order: 0,
    created_at: '2026-05-14T00:00:00Z',
    modified_at: '2026-05-14T00:00:00Z',
    deleted_at: null,
    asset_path: null,
    asset_meta: null,
    file_api_uri: null,
  };
}

async function mountWithContent(docId: string, content: string) {
  // Mock the get_item_content IPC to return our content.
  vi.mocked(tauriCore.invoke).mockImplementation((cmd: string) => {
    if (cmd === 'get_item_content') return Promise.resolve(content);
    return Promise.resolve(undefined);
  });

  // Seed the vault store so DocEditor can resolve the item.
  useVaultStore.setState({ items: [makeDoc(docId)], trashItems: [] });
  useWorkspaceStore.getState().openDoc(docId);

  render(
    <>
      <Toaster />
      <DocEditor docId={docId} />
    </>,
  );
  // Wait for the get_item_content promise to settle.
  const found = await screen.findByDisplayValue(content);
  return found as unknown as HTMLTextAreaElement;
}

describe('DocEditor — Tab placeholder navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkspaceStore.getState().clear();
  });

  it('Tab from start selects the first {{placeholder}}', async () => {
    const text = 'Hello {{name}}, age {{age}}.';
    const ta = await mountWithContent('d1', text);
    ta.focus();
    ta.setSelectionRange(0, 0);

    fireEvent.keyDown(ta, { key: 'Tab' });

    expect(ta.selectionStart).toBe(text.indexOf('{{name}}'));
    expect(ta.selectionEnd).toBe(text.indexOf('{{name}}') + '{{name}}'.length);
  });

  it('Tab advances to next placeholder when cursor is inside one', async () => {
    const text = 'A {{first}} B {{second}} C';
    const ta = await mountWithContent('d2', text);
    ta.focus();
    // Cursor right after `{{first}}` open brace.
    const firstStart = text.indexOf('{{first}}');
    ta.setSelectionRange(firstStart + 2, firstStart + 2);

    fireEvent.keyDown(ta, { key: 'Tab' });

    const secondStart = text.indexOf('{{second}}');
    expect(ta.selectionStart).toBe(secondStart);
    expect(ta.selectionEnd).toBe(secondStart + '{{second}}'.length);
  });

  it('Tab wraps to first placeholder when past the last', async () => {
    const text = 'A {{first}} B {{second}}';
    const ta = await mountWithContent('d3', text);
    ta.focus();
    ta.setSelectionRange(text.length, text.length);

    fireEvent.keyDown(ta, { key: 'Tab' });

    const firstStart = text.indexOf('{{first}}');
    expect(ta.selectionStart).toBe(firstStart);
  });

  it('Shift+Tab selects previous placeholder; wraps to last', async () => {
    const text = '{{a}} mid {{b}}';
    const ta = await mountWithContent('d4', text);
    ta.focus();
    ta.setSelectionRange(0, 0);

    fireEvent.keyDown(ta, { key: 'Tab', shiftKey: true });

    const bStart = text.indexOf('{{b}}');
    expect(ta.selectionStart).toBe(bStart);
    expect(ta.selectionEnd).toBe(bStart + '{{b}}'.length);
  });

  it('Tab inserts two spaces when no placeholders exist', async () => {
    const text = 'plain text no tokens';
    const ta = await mountWithContent('d5', text);
    ta.focus();
    ta.setSelectionRange(5, 5);

    fireEvent.keyDown(ta, { key: 'Tab' });

    // Inserting two spaces at index 5 in 'plain text no tokens' yields
    // 'plain' + '  ' + ' text no tokens' (the original space at 5 stays).
    expect(ta.value).toBe('plain   text no tokens');
  });

  it('Shift+Tab is a no-op when no placeholders exist', async () => {
    const text = 'plain text';
    const ta = await mountWithContent('d6', text);
    ta.focus();
    ta.setSelectionRange(3, 3);

    fireEvent.keyDown(ta, { key: 'Tab', shiftKey: true });

    expect(ta.value).toBe('plain text');
  });
});
