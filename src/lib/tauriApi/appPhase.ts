import { invoke } from '@tauri-apps/api/core';

import type { AppPhase } from '@/lib/types';

/** Read the current app phase from the backend. */
export async function getAppPhase(): Promise<AppPhase> {
  return invoke<AppPhase>('get_app_phase');
}

/** Dev-only: drive the phase machine from the frontend so transitions can be exercised
 * before Auth lands in Phase 1. The backend handler is `cfg(debug_assertions)`-only. */
export async function devSetAppPhase(phase: AppPhase): Promise<void> {
  return invoke('dev_set_app_phase', { phase });
}
