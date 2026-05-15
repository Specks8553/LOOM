import { useCallback, useRef, useState } from 'react';

import { CachedMessageConfirmModal } from '@/components/theater/CachedMessageConfirmModal';
import { useCacheStore } from '@/stores/cacheStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

interface PendingAction {
  action: 'edit' | 'delete';
  scope: 'story' | 'consulting';
}

/**
 * Doc 22 §Cached-message Edit/Delete Protection.
 *
 * Returns `(modalElement, guard)`. Components render `modalElement` somewhere
 * in their tree; before invoking edit / delete on a story-kind message, they
 * call `guard(message, action)` which returns a Promise that resolves
 * `true` to proceed, `false` to cancel. When the message is not in the
 * active cache, the guard resolves immediately without showing the modal.
 *
 * Predicate uses the workspace's loaded messages list to compare
 * `created_at` against the cache's high-water message — matches
 * `services/cache.rs::is_cached_story_message` semantics.
 */
export function useCachedMessageGuard(): {
  modal: React.ReactElement | null;
  guard: (message: ChatMessage, action: 'edit' | 'delete') => Promise<boolean>;
} {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);

  const guard = useCallback((message: ChatMessage, action: 'edit' | 'delete'): Promise<boolean> => {
    if (message.kind !== 'story') return Promise.resolve(true);
    const cache = useCacheStore.getState().byStory[message.story_id];
    if (!cache || cache.cache_name === null) return Promise.resolve(true);
    const highWater = cache.last_cached_message_id;
    if (highWater === null) return Promise.resolve(true);
    const messages = useWorkspaceStore.getState().messages;
    const high = messages.find((m) => m.id === highWater);
    if (!high) return Promise.resolve(true);
    // Inclusive — the high-water message itself is cached.
    if (message.created_at > high.created_at) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ action, scope: 'story' });
    });
  }, []);

  function resolve(proceed: boolean): void {
    const r = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    if (r) r(proceed);
  }

  const modal = pending ? (
    <CachedMessageConfirmModal
      action={pending.action}
      scope={pending.scope}
      onConfirm={() => resolve(true)}
      onCancel={() => resolve(false)}
    />
  ) : null;

  return { modal, guard };
}
