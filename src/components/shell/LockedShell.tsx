import { useRef, useState } from 'react';

import { unlockVault } from '@/lib/tauriApi/auth';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

export function LockedShell() {
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  const onUnlock = useAuthStore((s) => s.onUnlock);

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await unlockVault(password);
      onUnlock(result.has_api_key, Number(result.auto_lock_secs));
      setAppPhase('workspace');
    } catch {
      setError('Incorrect password.');
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid h-full place-items-center bg-[var(--color-bg-base)]">
      <div className="flex w-full max-w-xs flex-col gap-6 px-4">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          LOOM
        </h1>

        <form className="flex flex-col gap-3" onSubmit={(e) => void handleUnlock(e)}>
          <input
            ref={inputRef}
            type="password"
            autoFocus
            autoComplete="current-password"
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError('');
            }}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !password}
            className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </main>
  );
}
