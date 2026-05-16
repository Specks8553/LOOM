//! Settings & Themes Tauri commands (Doc 20 §Backend API, Phase 11).
//!
//! Thin handlers — validate, call into `services/settings.rs` and
//! `db/{settings,templates}.rs`, emit `settings_changed`. The cascade resolver
//! and the per-key validators live in `services/settings.rs`; this layer never
//! re-implements them.
//!
//! The API key is deliberately absent from every command here — it has its own
//! `set_api_key` / `has_api_key` pair in `commands/auth.rs` so the secret never
//! flows through the generic settings path or into `get_app_settings`.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tracing::info;

use crate::db::settings as db_settings;
use crate::db::templates::{self as db_templates, Template};
use crate::error::LoomError;
use crate::services::settings::{self, ResolvedSettings};
use crate::services::settings_keys::AppSettingKey;
use crate::state::access;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct SettingsChangedPayload<'a> {
    scope: &'a str,
    key: &'a str,
}

fn emit_settings_changed(app: &tauri::AppHandle, scope: &str, key: &str) -> Result<(), LoomError> {
    app.emit("settings_changed", SettingsChangedPayload { scope, key })
        .map_err(|e| LoomError::Internal(format!("emit settings_changed failed: {e}")))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Parse a raw column key into the typed enum, rejecting unknown keys.
fn parse_key(key: &str) -> Result<AppSettingKey, LoomError> {
    AppSettingKey::from_key_str(key)
        .ok_or_else(|| LoomError::validation(format!("unknown setting key: {key}")))
}

fn world_is_open(state: &AppState) -> bool {
    access::with_active_world_id(state, |_| Ok(())).is_ok()
}

/// Merged settings cascade for the current world (or App-only when no world is
/// open). The frontend consumes this directly — theme, gen params, ceilings.
#[tauri::command]
pub fn get_resolved_settings(app: tauri::AppHandle) -> Result<ResolvedSettings, LoomError> {
    let state = app.state::<AppState>();
    if world_is_open(&state) {
        access::with_two_conns(&state, |app_db, world_db| {
            settings::resolve_all(world_db, app_db)
        })
    } else {
        access::with_settings_conn(&state, settings::resolve_all_app_only)
    }
}

/// Raw `app_settings` values for the Settings UI App chapter. Excludes
/// `api_key` — the secret is never returned to the frontend.
#[tauri::command]
pub fn get_app_settings(app: tauri::AppHandle) -> Result<HashMap<String, String>, LoomError> {
    let state = app.state::<AppState>();
    access::with_settings_conn(&state, |conn| {
        let mut out = HashMap::new();
        for &key in AppSettingKey::ALL {
            if key == AppSettingKey::ApiKey {
                continue;
            }
            let value: String = db_settings::get_app_setting(conn, key)?;
            out.insert(key.as_str().to_owned(), value);
        }
        Ok(out)
    })
}

/// Raw world `settings` overrides (only the rows actually present). Drives the
/// `↺` revert affordance in the World chapter.
#[tauri::command]
pub fn get_world_settings(app: tauri::AppHandle) -> Result<HashMap<String, String>, LoomError> {
    let state = app.state::<AppState>();
    access::with_active_conn(&state, |conn| {
        Ok(db_settings::all_world_overrides(conn)?
            .into_iter()
            .collect())
    })
}

/// Write an `app_settings` value. Server-side validation per Doc 20 §Validation.
#[tauri::command]
pub fn save_app_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let parsed = parse_key(&key)?;
    settings::validate_setting(parsed, &value)?;
    access::with_settings_conn(&state, |conn| {
        db_settings::set_app_setting(conn, parsed, &value)
    })?;
    info!(key = %key, "save_app_setting");
    emit_settings_changed(&app, "app", &key)?;
    Ok(())
}

/// Write a world `settings` override. Auto-creates the row (cascade UX —
/// editing a value in the World chapter is the override gesture).
#[tauri::command]
pub fn save_world_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let parsed = parse_key(&key)?;
    settings::validate_setting(parsed, &value)?;
    access::with_active_conn(&state, |conn| {
        db_settings::set_world_setting(conn, parsed, &value)
    })?;
    info!(key = %key, "save_world_setting");
    emit_settings_changed(&app, "world", &key)?;
    Ok(())
}

/// Delete a world override so the cascade falls back to the App default.
#[tauri::command]
pub fn clear_world_override(app: tauri::AppHandle, key: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let parsed = parse_key(&key)?;
    access::with_active_conn(&state, |conn| {
        db_settings::clear_world_setting(conn, parsed)
    })?;
    info!(key = %key, "clear_world_override");
    emit_settings_changed(&app, "world", &key)?;
    Ok(())
}

/// Clear every world override on a Settings tab. Returns the number cleared.
#[tauri::command]
pub fn clear_all_world_overrides_in_tab(
    app: tauri::AppHandle,
    tab: String,
) -> Result<u32, LoomError> {
    let state = app.state::<AppState>();
    let keys = settings::world_tab_keys(&tab);
    let count = access::with_active_conn(&state, |conn| {
        let mut cleared = 0u32;
        for &key in keys {
            if db_settings::get_world_setting(conn, key)?.is_some() {
                db_settings::clear_world_setting(conn, key)?;
                cleared += 1;
            }
        }
        Ok(cleared)
    })?;
    info!(tab = %tab, count, "clear_all_world_overrides_in_tab");
    emit_settings_changed(&app, "world", &tab)?;
    Ok(count)
}

/// Restore a `prompt_*` or system-instruction key to its hardcoded baseline
/// (Doc 20 §Developer, §System Instructions).
#[tauri::command]
pub fn restore_prompt_default(app: tauri::AppHandle, key: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let parsed = parse_key(&key)?;
    let baseline = settings::prompt_baseline(parsed);
    access::with_settings_conn(&state, |conn| {
        db_settings::set_app_setting(conn, parsed, baseline)
    })?;
    info!(key = %key, "restore_prompt_default");
    emit_settings_changed(&app, "app", &key)?;
    Ok(())
}

// --- Templates (Doc 20 §Templates) ---
//
// Templates live in the world's `loom.db` (Doc 03 §`templates`); there is no
// app-level template store, so every template command requires an open world.

/// Built-in + user-created templates for the active world.
#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<Template>, LoomError> {
    let state = app.state::<AppState>();
    access::with_active_conn(&state, db_templates::list)
}

/// Create or update a template. Built-in immutable fields (`slug`,
/// `is_builtin`, `created_at`) are preserved from the stored row.
#[tauri::command]
pub fn save_template(app: tauri::AppHandle, template: Template) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let now = now_iso();
    access::with_active_conn(&state, |conn| {
        let mut t = template;
        if t.id.trim().is_empty() {
            t.id = uuid::Uuid::new_v4().to_string();
        }
        if t.name.trim().is_empty() {
            return Err(LoomError::validation("Template name cannot be empty."));
        }
        match db_templates::get(conn, &t.id)? {
            Some(existing) if existing.is_builtin => {
                // Built-ins: only name / icon / default_content are editable.
                t.slug = existing.slug;
                t.is_builtin = true;
                t.created_at = existing.created_at;
            }
            Some(existing) => {
                t.is_builtin = false;
                t.created_at = existing.created_at;
            }
            None => {
                t.is_builtin = false;
                if t.created_at.trim().is_empty() {
                    t.created_at = now.clone();
                }
            }
        }
        if t.slug.trim().is_empty() {
            t.slug = t.id.clone();
        }
        t.modified_at = now.clone();
        db_templates::upsert(conn, &t)
    })?;
    emit_settings_changed(&app, "world", "templates")?;
    Ok(())
}

/// Delete a user-created template. Built-ins return `LoomError::Forbidden`.
#[tauri::command]
pub fn delete_template(app: tauri::AppHandle, id: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    access::with_active_conn(&state, |conn| {
        let template = db_templates::get(conn, &id)?
            .ok_or_else(|| LoomError::NotFound(format!("template {id} not found")))?;
        if template.is_builtin {
            return Err(LoomError::Forbidden(
                "Built-in templates cannot be deleted.".into(),
            ));
        }
        db_templates::delete(conn, &id)
    })?;
    emit_settings_changed(&app, "world", "templates")?;
    Ok(())
}

/// Restore a built-in template's name / icon / content to its baseline.
#[tauri::command]
pub fn restore_template_default(app: tauri::AppHandle, id: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let now = now_iso();
    let restored = access::with_active_conn(&state, |conn| {
        db_templates::restore_builtin(conn, &id, &now)
    })?;
    if !restored {
        return Err(LoomError::validation(format!(
            "{id} is not a built-in template"
        )));
    }
    emit_settings_changed(&app, "world", "templates")?;
    Ok(())
}
