import { invoke } from '@tauri-apps/api/core';

import type { ResolvedSettings, Template } from '@/lib/types';

// --- Doc 20 §Backend API. Typed wrappers for `commands/settings.rs`. ---
//
// The API key is absent here by design — it has its own `set_api_key` /
// `has_api_key` wrappers in `tauriApi/auth.ts` so the secret never flows
// through the generic settings path.

/** Merged cascade for the current world (App-only when no world is open). */
export async function getResolvedSettings(): Promise<ResolvedSettings> {
  return invoke<ResolvedSettings>('get_resolved_settings');
}

/** Raw `app_settings` values for the App chapter (excludes `api_key`). */
export async function getAppSettings(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_app_settings');
}

/** Raw world `settings` overrides — only the keys actually overridden. */
export async function getWorldSettings(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_world_settings');
}

/** Write an App-scope setting. Server-side validated. */
export async function saveAppSetting(key: string, value: string): Promise<void> {
  return invoke('save_app_setting', { key, value });
}

/** Write a World-scope override (auto-creates the override row). */
export async function saveWorldSetting(key: string, value: string): Promise<void> {
  return invoke('save_world_setting', { key, value });
}

/** Delete a world override so the cascade falls back to the App default. */
export async function clearWorldOverride(key: string): Promise<void> {
  return invoke('clear_world_override', { key });
}

/** Clear every world override on a Settings tab. Returns the count cleared. */
export async function clearAllWorldOverridesInTab(tab: string): Promise<number> {
  return invoke<number>('clear_all_world_overrides_in_tab', { tab });
}

/** Restore a `prompt_*` / system-instruction key to its hardcoded baseline. */
export async function restorePromptDefault(key: string): Promise<void> {
  return invoke('restore_prompt_default', { key });
}

/** Built-in + user-created templates for the active world. */
export async function listTemplates(): Promise<Template[]> {
  return invoke<Template[]>('list_templates');
}

/** Create or update a template. Built-in immutable fields are preserved. */
export async function saveTemplate(template: Template): Promise<void> {
  return invoke('save_template', { template });
}

/** Delete a user-created template (built-ins are rejected backend-side). */
export async function deleteTemplate(id: string): Promise<void> {
  return invoke('delete_template', { id });
}

/** Restore a built-in template's name / icon / content to its baseline. */
export async function restoreTemplateDefault(id: string): Promise<void> {
  return invoke('restore_template_default', { id });
}
