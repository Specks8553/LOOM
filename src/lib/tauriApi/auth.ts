import { invoke } from '@tauri-apps/api/core';

import type { UnlockResult } from '@/lib/types';

/** Returns true if app_config.json exists (onboarding complete). */
export async function checkOnboarding(): Promise<boolean> {
  return invoke<boolean>('check_onboarding');
}

/** First-launch: derive key, write sentinel, create app_settings.db. */
export async function setupVault(password: string, apiKey?: string): Promise<void> {
  return invoke('setup_vault', { password, apiKey: apiKey ?? null });
}

/** Verify password against sentinel, open app_settings.db. */
export async function unlockVault(password: string): Promise<UnlockResult> {
  return invoke<UnlockResult>('unlock_vault', { password });
}

/** Zero master key + API key in AppState; close all DB connections. */
export async function lockVault(): Promise<void> {
  return invoke('lock_vault');
}

/** Re-derive key with new password, rewrite sentinel, rekey all DBs. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return invoke('change_password', { currentPassword, newPassword });
}

/** Write a new API key to app_settings.db and AppState. */
export async function setApiKey(key: string): Promise<void> {
  return invoke('set_api_key', { key });
}

/** Returns true if a non-empty API key is configured. Never returns the key. */
export async function hasApiKey(): Promise<boolean> {
  return invoke<boolean>('has_api_key');
}
