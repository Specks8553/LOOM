// Central error-display router (CD-33 — Doc 12 §Error Display Hierarchy).
//
// Every Tauri command returns `Result<T, LoomError>`; a rejection arrives in JS
// as the *deserialized* error value (NOT a JS `Error`), shaped
// `{ kind, message }` (adjacently tagged — Doc 05 §LoomError, HB-01). The old
// catch pattern `toast.error(e instanceof Error ? e.message : '…')` had a dead
// branch (`instanceof Error` is never true for an IPC rejection) so only the
// hardcoded fallback ever rendered. This module reads `.kind` and routes to the
// tier + copy Doc 12 §0 specifies.

import { toast } from 'sonner';

import { useErrorModalStore } from '../stores/errorModalStore';

import type { LoomError } from './types';

type Surface = 'toast' | 'toast-persistent' | 'modal';

interface Rule {
  surface: Surface;
  /** Canned copy. When omitted, the backend `message` string is used. */
  copy?: string;
  /** Modal title (modal surface only). */
  title?: string;
}

const TOAST_ERROR_MS = 6000;

/** Doc 12 §Error Display Hierarchy §0 — variant → surface + copy. */
const RULES: Record<LoomError['kind'], Rule> = {
  crypto: {
    surface: 'modal',
    title: 'Could not unlock vault',
    copy: 'Could not unlock or decrypt your vault data.',
  },
  database: {
    surface: 'modal',
    title: 'Database error',
    copy: 'A database error occurred. Your data may not have been saved.',
  },
  not_found: { surface: 'toast', copy: 'That item could no longer be found.' },
  validation: { surface: 'toast' }, // uses message.reason (see below)
  forbidden: { surface: 'toast' }, // uses backend message (op is prohibited)
  api_error: { surface: 'toast', copy: 'Cannot reach the AI service. Check your connection.' },
  cache_create: {
    surface: 'toast',
    copy: "Couldn't attach story context; sent without the cache.",
  },
  rate_limited: {
    surface: 'toast-persistent',
    copy: 'Rate limit reached. Wait a moment before sending.',
  },
  io: { surface: 'toast', copy: 'Failed to save. Check available disk space.' },
  serialization: { surface: 'toast', copy: 'Something went wrong processing data.' },
  internal: { surface: 'toast', copy: 'An unexpected error occurred.' },
};

/** Generation errors arrive out-of-band via the `generation_failed` /
 *  `session_generation_failed` events as a plain `error_kind` string, not a
 *  command `Result`. Same sink, so copy + surface match (Doc 12 §0 note). */
const GENERATION_RULES: Record<string, Rule> = {
  api_error: RULES.api_error,
  rate_limited: RULES.rate_limited,
  validation: { surface: 'toast', copy: 'That request could not be sent.' },
  internal: RULES.internal,
};

/** Narrow an unknown caught value to a `LoomError` if it has the wire shape. */
export function parseLoomError(e: unknown): LoomError | null {
  if (typeof e !== 'object' || e === null) return null;
  const obj = e as Record<string, unknown>;
  if (typeof obj.kind !== 'string') return null;
  if (!(obj.kind in RULES)) return null;
  return obj as unknown as LoomError;
}

/** Extract the human-readable string from a parsed error's `message`
 *  (String variants) or `message.reason` (the Validation struct variant). */
function messageText(err: LoomError): string | null {
  const msg = (err as { message?: unknown }).message;
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object' && typeof (msg as { reason?: unknown }).reason === 'string') {
    return (msg as { reason: string }).reason;
  }
  return null;
}

function emit(rule: Rule, fallbackCopy: string): void {
  const copy = rule.copy ?? fallbackCopy;
  if (rule.surface === 'modal') {
    useErrorModalStore.getState().show({
      title: rule.title ?? 'Something went wrong',
      body: copy,
    });
    return;
  }
  toast.error(copy, {
    duration: rule.surface === 'toast-persistent' ? Infinity : TOAST_ERROR_MS,
  });
}

/**
 * Route a caught command error to its Doc 12 surface + copy.
 *
 * @param e         the value caught from a rejected `invoke`/tauriApi call
 * @param fallback  copy to show when `e` is not a recognizable `LoomError`
 *                  (network blip before the command ran, a thrown JS error, …)
 */
export function surfaceError(e: unknown, fallback = 'Something went wrong.'): void {
  const err = parseLoomError(e);
  if (!err) {
    toast.error(fallback, { duration: TOAST_ERROR_MS });
    return;
  }
  const rule = RULES[err.kind];
  // Variants that carry their own user-facing text (validation reason, the
  // prohibited-op message) prefer the backend message over canned copy.
  const preferMessage = err.kind === 'validation' || err.kind === 'forbidden';
  const msg = messageText(err);
  emit(rule, (preferMessage && msg) || rule.copy || msg || fallback);
}

/** Route a generation-failure `error_kind` (event-driven) to a toast/modal. */
export function surfaceGenerationError(errorKind: string): void {
  const rule = GENERATION_RULES[errorKind] ?? RULES.internal;
  emit(rule, rule.copy ?? 'Generation failed.');
}

/** Extract a human-readable string from a caught value — the backend message
 *  for a `LoomError`, else a best-effort string. For diagnostic fields
 *  (`generationStatus.detail`) and inline auth-screen errors that don't go
 *  through the toast/modal tiers. */
export function errorMessage(e: unknown): string {
  const err = parseLoomError(e);
  if (err) return messageText(err) ?? err.kind;
  if (e instanceof Error) return e.message;
  return String(e);
}
