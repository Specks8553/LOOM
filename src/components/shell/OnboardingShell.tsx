import { useState } from 'react';

import { setupVault } from '@/lib/tauriApi/auth';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

type Step = 'password' | 'api-key';

export function OnboardingShell() {
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  const onUnlock = useAuthStore((s) => s.onUnlock);

  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // --- Step 1: password ---
  const passwordValid = password.length >= 8 && password === confirm;

  function handlePasswordContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordValid) return;
    setError('');
    setStep('api-key');
  }

  // --- Step 2: API key ---
  async function handleFinish(skipApiKey: boolean) {
    setSubmitting(true);
    setError('');
    try {
      await setupVault(password, skipApiKey ? undefined : apiKey);
      onUnlock(!skipApiKey && apiKey.length > 0, 900);
      setAppPhase('workspace');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid h-full place-items-center bg-[var(--color-bg-base)]">
      <div className="flex w-full max-w-sm flex-col gap-6 px-4">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          LOOM
        </h1>

        {step === 'password' && (
          <form className="flex flex-col gap-4" onSubmit={handlePasswordContinue}>
            <p className="text-center text-sm text-[var(--color-text-muted)]">
              Create a master password to encrypt your vault.
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="ob-password">
                Password
              </label>
              <input
                id="ob-password"
                type="password"
                autoFocus
                autoComplete="new-password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="ob-confirm">
                Confirm password
              </label>
              <input
                id="ob-confirm"
                type="password"
                autoComplete="new-password"
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm.length > 0 && password !== confirm && (
                <p className="text-xs text-red-400">Passwords do not match.</p>
              )}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={!passwordValid}
              className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              Continue
            </button>
          </form>
        )}

        {step === 'api-key' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-[var(--color-text-muted)]">
              Enter your Gemini API key.
            </p>
            <p className="text-center text-xs text-[var(--color-text-muted)]">
              Your Gemini API key. Never sent anywhere except Google's API.
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--color-text-muted)]" htmlFor="ob-apikey">
                API key
              </label>
              <input
                id="ob-apikey"
                type="password"
                autoFocus
                autoComplete="off"
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKey.length > 0) {
                    void handleFinish(false);
                  }
                }}
              />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={submitting || apiKey.length === 0}
                className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                onClick={() => void handleFinish(false)}
              >
                {submitting ? 'Setting up…' : 'Finish'}
              </button>
              <button
                type="button"
                disabled={submitting}
                className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
                onClick={() => void handleFinish(true)}
              >
                Skip for now
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
