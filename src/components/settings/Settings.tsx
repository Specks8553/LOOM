import { ArrowLeft, Flag, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { tabsForChapter } from '@/lib/settingsSchema';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useVaultStore } from '@/stores/vaultStore';

import { SettingsTabContent } from './SettingsTabContent';

import type { Chapter } from './SettingsTabContent';

/**
 * Doc 20 §Surface and Navigation. Full-surface Settings — the highest-priority
 * Theater content (CD-5). `← Back` exits; the App / World chapter switcher
 * swaps the tab list. Escape closes (escape-chain slot 2, Doc 11).
 */
export function Settings() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const refreshAll = useSettingsStore((s) => s.refreshAll);
  const worldOpen = useVaultStore((s) => s.activeWorldId !== null);

  const [chapter, setChapter] = useState<Chapter>('app');
  const [tabId, setTabId] = useState('general');
  const [query, setQuery] = useState('');
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  // Load every settings surface once when Settings opens.
  useEffect(() => {
    void refreshAll().catch((e) => console.error('settings load failed', e));
  }, [refreshAll]);

  // Escape closes Settings (escape-chain slot 2).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSettings();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  const tabs = useMemo(() => tabsForChapter(chapter), [chapter]);
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  function switchChapter(next: Chapter) {
    setChapter(next);
    setOnlyOverridden(false);
    // The App-only tabs vanish in the World chapter — keep a valid selection.
    const nextTabs = tabsForChapter(next);
    if (!nextTabs.some((t) => t.id === tabId)) {
      setTabId(nextTabs[0]?.id ?? 'appearance');
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-base)]">
      {/* Top bar */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3">
        <button
          type="button"
          onClick={closeSettings}
          className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          aria-label="Close settings"
        >
          <ArrowLeft size={14} aria-hidden />
          <span>Back</span>
        </button>
        <span className="text-[13px] text-[var(--color-text-primary)]">Settings</span>

        {/* Chapter switcher */}
        <div className="ml-4 flex items-center gap-0.5 rounded-sm border border-[var(--color-border)] p-0.5">
          {(['app', 'world'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => switchChapter(c)}
              disabled={c === 'world' && !worldOpen}
              className={cn(
                'rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider',
                chapter === c
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
                c === 'world' &&
                  !worldOpen &&
                  'cursor-default opacity-40 hover:text-[var(--color-text-muted)]',
              )}
              title={c === 'world' && !worldOpen ? 'Open a world to edit its overrides' : undefined}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Search + override filter */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2">
            <Search size={12} aria-hidden className="text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              className="w-40 bg-transparent py-1 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          {chapter === 'world' && (
            <button
              type="button"
              onClick={() => setOnlyOverridden((v) => !v)}
              aria-pressed={onlyOverridden}
              title="Show only overridden settings"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--color-border)]',
                onlyOverridden
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <Flag size={12} aria-hidden />
            </button>
          )}
        </div>
      </header>

      {/* Body: tab list + detail pane */}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-[var(--color-border)] p-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTabId(t.id)}
              className={cn(
                'rounded-sm px-2 py-1.5 text-left text-[13px]',
                t.id === activeTab?.id
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {activeTab !== undefined && (
            <SettingsTabContent
              key={`${chapter}:${activeTab.id}`}
              tab={activeTab}
              chapter={chapter}
              query={query.trim().toLowerCase()}
              onlyOverridden={onlyOverridden}
            />
          )}
        </div>
      </div>
    </div>
  );
}
