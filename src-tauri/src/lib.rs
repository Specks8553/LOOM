mod config;
mod crypto;
mod db;
mod error;
mod gemini;
mod messages;
mod rate_limiter;
mod state;
mod vault;
mod world;

use error::LoomError;
use gemini::{ChatMessage, StoryPayload, StreamDone, UserContent};
use state::AppState;
use vault::{VaultItemMeta, VaultItem, Template, ContextDoc};
use world::WorldMeta;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Check if app_config.json exists and is valid.
#[tauri::command]
async fn check_app_config() -> Result<bool, LoomError> {
    config::check_app_config()
}

/// Create a new app_config.json from a master password.
/// Stores the derived master key in AppState so create_world can use it.
#[tauri::command]
async fn create_app_config(
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if password.len() < 8 {
        return Err(LoomError::Validation(
            "Password must be at least 8 characters.".into(),
        ));
    }
    let key = config::create_app_config(&password)?;

    // Store master key in AppState for subsequent commands (create_world, etc.)
    let mut key_guard = state.master_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock master key: {}", e))
    })?;
    *key_guard = Some(key);

    Ok(())
}

/// Create a new world.
#[tauri::command]
async fn create_world(
    name: String,
    tags: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<WorldMeta, LoomError> {
    if name.len() < 2 {
        return Err(LoomError::Validation(
            "World name must be at least 2 characters.".into(),
        ));
    }
    if name.len() > 80 {
        return Err(LoomError::Validation(
            "World name must be at most 80 characters.".into(),
        ));
    }

    let key_guard = state.master_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock master key: {}", e))
    })?;
    let key = key_guard.as_ref().ok_or(LoomError::VaultLocked)?;

    world::create_world(&name, tags, key)
}

/// List all (non-deleted) worlds.
#[tauri::command]
async fn list_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    world::list_worlds()
}

/// Unlock the vault with a password.
#[tauri::command]
async fn unlock_vault(
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let app_config = config::read_app_config()?;

    // Derive key from password
    let salt = hex::decode(&app_config.pbkdf2_salt_hex)?;
    let key = crypto::derive_key(&password, &salt, app_config.pbkdf2_iterations);

    // Verify against sentinel
    if !crypto::verify_sentinel(&key, &app_config.key_check) {
        return Err(LoomError::IncorrectPassword);
    }

    // Store master key
    {
        let mut key_guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master key: {}", e))
        })?;
        *key_guard = Some(key);
    }

    // If there's an active world, open its database
    if let Some(ref world_id) = app_config.active_world_id {
        let world_dir = world::world_dir_path(world_id)?;
        let db_path = world_dir.join("loom.db");

        let key_guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master key: {}", e))
        })?;
        let master_key = key_guard.as_ref().ok_or(LoomError::VaultLocked)?;

        let conn = db::open_world_db(&db_path, master_key)?;

        // Load API key from settings
        let api_key: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'api_key'",
                [],
                |row| row.get(0),
            )
            .ok();

        {
            let mut conn_guard = state.active_conn.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock connection: {}", e))
            })?;
            *conn_guard = Some(conn);
        }

        {
            let mut wid_guard = state.active_world_id.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock world id: {}", e))
            })?;
            *wid_guard = Some(world_id.clone());
        }

        if let Some(key_val) = api_key {
            if !key_val.is_empty() {
                let mut api_guard = state.api_key.lock().map_err(|e| {
                    LoomError::Internal(format!("Failed to lock api key: {}", e))
                })?;
                *api_guard = Some(key_val);
            }
        }
    }

    log::info!("Vault unlocked successfully");
    Ok(())
}

/// Lock the vault: close DB, zero keys.
#[tauri::command]
async fn lock_vault(state: tauri::State<'_, AppState>) -> Result<(), LoomError> {
    state.clear_sensitive();
    log::info!("Vault locked");
    Ok(())
}

/// Validate a Gemini API key and store it in AppState (memory only).
#[tauri::command]
async fn validate_and_store_api_key(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if key.trim().is_empty() {
        return Err(LoomError::Validation("API key cannot be empty.".into()));
    }

    // Test the key against Gemini API
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        key.trim()
    );
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| LoomError::ApiRequest(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(LoomError::ApiRequest(
            "Key rejected by Gemini. Check and try again.".into(),
        ));
    }

    // Store in memory
    let mut api_guard = state.api_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock api key: {}", e))
    })?;
    *api_guard = Some(key.trim().to_string());

    log::info!("API key validated and stored in memory");
    Ok(())
}

/// Save the API key from AppState to the active world's settings table.
#[tauri::command]
async fn save_api_key_to_db(
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let api_key = {
        let guard = state.api_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock api key: {}", e))
        })?;
        guard.clone().ok_or(LoomError::ApiKeyMissing)?
    };

    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('api_key', ?1)",
        rusqlite::params![api_key],
    )?;

    log::info!("API key persisted to world database");
    Ok(())
}

/// Generate a recovery file JSON string.
#[tauri::command]
async fn generate_recovery_file() -> Result<String, LoomError> {
    let app_config = config::read_app_config()?;
    let recovery = serde_json::json!({
        "loom_recovery_version": 1,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "pbkdf2_salt_hex": app_config.pbkdf2_salt_hex,
        "pbkdf2_iterations": app_config.pbkdf2_iterations,
        "pbkdf2_algorithm": "HMAC-SHA256",
        "warning": "This file does NOT contain your password or encryption key."
    });
    Ok(serde_json::to_string_pretty(&recovery)?)
}

/// Restore app_config.json from a recovery file.
/// User must provide a new password to re-derive the key.
#[tauri::command]
async fn restore_app_config(
    recovery_json: String,
    password: String,
) -> Result<(), LoomError> {
    if password.len() < 8 {
        return Err(LoomError::Validation(
            "Password must be at least 8 characters.".into(),
        ));
    }

    let recovery: serde_json::Value = serde_json::from_str(&recovery_json)
        .map_err(|e| LoomError::ConfigCorrupted(format!("Invalid recovery file: {}", e)))?;

    let salt_hex = recovery["pbkdf2_salt_hex"]
        .as_str()
        .ok_or_else(|| LoomError::ConfigCorrupted("Missing pbkdf2_salt_hex".into()))?;
    let iterations = recovery["pbkdf2_iterations"]
        .as_u64()
        .ok_or_else(|| LoomError::ConfigCorrupted("Missing pbkdf2_iterations".into()))?
        as u32;

    let salt = hex::decode(salt_hex)?;
    let key = crypto::derive_key(&password, &salt, iterations);
    let sentinel = crypto::create_sentinel(&key)?;

    // Scan for existing world directories
    let data_dir = config::app_data_dir()?;
    let worlds_dir = data_dir.join("worlds");
    let mut world_entries = Vec::new();

    if worlds_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&worlds_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let world_id = entry.file_name().to_string_lossy().to_string();
                    let meta_path = entry.path().join("world_meta.json");
                    if meta_path.exists() {
                        world_entries.push(config::WorldEntry {
                            id: world_id.clone(),
                            dir: format!("worlds/{}", world_id),
                            deleted_at: None,
                        });
                    }
                }
            }
        }
    }

    let active_id = world_entries.first().map(|e| e.id.clone());

    let new_config = config::AppConfig {
        version: 1,
        pbkdf2_salt_hex: salt_hex.to_string(),
        pbkdf2_iterations: iterations,
        key_check: sentinel,
        active_world_id: active_id,
        worlds: world_entries,
    };

    config::write_app_config_atomic(&new_config)?;
    log::info!("App config restored from recovery file");
    Ok(())
}

// ─── World Management Commands ────────────────────────────────────────────────

/// Switch to a different world.
#[tauri::command]
async fn switch_world(
    world_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorldMeta, LoomError> {
    world::switch_world(&state, &world_id)
}

/// Rename a world.
#[tauri::command]
async fn rename_world(world_id: String, name: String) -> Result<(), LoomError> {
    if name.len() < 2 {
        return Err(LoomError::Validation("World name must be at least 2 characters.".into()));
    }
    if name.len() > 80 {
        return Err(LoomError::Validation("World name must be at most 80 characters.".into()));
    }
    world::rename_world(&world_id, &name)
}

/// Soft-delete a world.
#[tauri::command]
async fn delete_world(world_id: String) -> Result<(), LoomError> {
    world::delete_world(&world_id)
}

/// Restore a soft-deleted world.
#[tauri::command]
async fn restore_world(world_id: String) -> Result<(), LoomError> {
    world::restore_world(&world_id)
}

/// Permanently delete a world.
#[tauri::command]
async fn purge_world(world_id: String) -> Result<(), LoomError> {
    world::purge_world(&world_id)
}

/// List all soft-deleted worlds.
#[tauri::command]
async fn list_deleted_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    world::list_deleted_worlds()
}

// ─── Vault Item Commands ──────────────────────────────────────────────────────

/// List all non-deleted vault items in the active world.
#[tauri::command]
async fn vault_list_items(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::list_items(conn)
}

/// List all soft-deleted vault items (trash).
#[tauri::command]
async fn vault_list_trash(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::list_trash(conn)
}

/// Create a new vault item.
#[tauri::command]
async fn vault_create_item(
    item_type: String,
    name: String,
    parent_id: Option<String>,
    subtype: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<VaultItemMeta, LoomError> {
    if name.trim().is_empty() {
        return Err(LoomError::Validation("Item name cannot be empty.".into()));
    }
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::create_item(conn, &item_type, name.trim(), parent_id.as_deref(), subtype.as_deref())
}

/// Rename a vault item.
#[tauri::command]
async fn vault_rename_item(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if name.trim().is_empty() {
        return Err(LoomError::Validation("Item name cannot be empty.".into()));
    }
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::rename_item(conn, &id, name.trim())
}

/// Move a vault item to a new parent with a new sort order.
#[tauri::command]
async fn vault_move_item(
    id: String,
    new_parent_id: Option<String>,
    new_sort_order: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::move_item(conn, &id, new_parent_id.as_deref(), new_sort_order)
}

/// Soft-delete a vault item.
#[tauri::command]
async fn vault_soft_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::soft_delete(conn, &id)
}

/// Restore a soft-deleted vault item.
#[tauri::command]
async fn vault_restore_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::restore_item(conn, &id)
}

/// Permanently delete a vault item.
#[tauri::command]
async fn vault_purge_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::purge_item(conn, &id)
}

/// Batch update sort order for vault items.
#[tauri::command]
async fn vault_update_sort_order(
    items: Vec<(String, i64)>,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::update_sort_order(conn, &items)
}

// ─── Phase 6: Conversation Commands ──────────────────────────────────────────

/// Send a message: insert user msg, stream AI response, insert model msg.
/// Doc 09 §5.1–§5.2.
#[tauri::command]
async fn send_message(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    story_id: String,
    leaf_id: Option<String>,
    user_content: UserContent,
    temp_model_id: String,
) -> Result<StreamDone, LoomError> {
    use tauri::Emitter;
    use tokio::sync::watch;

    if user_content.plot_direction.trim().is_empty() {
        return Err(LoomError::Validation("Plot direction cannot be empty.".into()));
    }

    // Get API key
    let api_key = {
        let guard = state.api_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock api key: {}", e))
        })?;
        guard.clone().ok_or(LoomError::ApiKeyMissing)?
    };

    // Phase 1: Insert user message + read history + load context docs (needs conn lock)
    let (user_msg, history, system_instructions, model_name, context_docs) = {
        let conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

        // Insert user message
        let user_msg = messages::insert_user_message(
            conn,
            &story_id,
            leaf_id.as_deref(),
            &user_content,
        )?;

        // Load history (branch from root → user_msg's parent, i.e. leaf_id)
        let history = if let Some(ref lid) = leaf_id {
            let payload = messages::load_story_messages(conn, &story_id, lid)?;
            payload.messages
        } else {
            vec![]
        };

        // Read active system instructions slot
        let active_slot: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'active_si_slot'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "1".to_string());

        let si_key = if active_slot == "2" {
            "system_instructions_2"
        } else {
            "system_instructions"
        };
        let sys_instr: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![si_key],
                |row| row.get(0),
            )
            .unwrap_or_default();

        let model: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'text_model_name'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "gemini-2.5-flash".to_string());

        // Load attached context docs (Doc 12 §7: inline in current turn, not in history)
        let ctx_docs = vault::get_context_docs(conn, &story_id)?;
        let context_docs: Vec<gemini::ContextDocContent> = ctx_docs
            .into_iter()
            .map(|d| gemini::ContextDocContent {
                name: d.name,
                content: d.content,
            })
            .collect();

        (user_msg, history, sys_instr, model, context_docs)
    }; // conn lock dropped here

    // Check rate limits before making the API call
    {
        let conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
        let status = rate_limiter::check_rate_limit(conn)?;
        if !status.can_proceed {
            return Err(LoomError::RateLimitExceeded);
        }
    }

    // Phase 2: Build request and stream (no conn lock held)
    let user_turn_text = gemini::build_user_turn_text(&user_content);
    let request_body = gemini::build_gemini_request(
        &system_instructions,
        &history,
        &user_turn_text,
        user_content.output_length,
        &context_docs,
    );

    // Create cancellation channel
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut tx_guard = state.cancel_tx.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock cancel_tx: {}", e))
        })?;
        *tx_guard = Some(cancel_tx);
    }

    let stream_result = gemini::stream_generate(
        &api_key,
        &model_name,
        &request_body,
        &app,
        &temp_model_id,
        cancel_rx,
    )
    .await;

    // Clear cancel handle
    {
        let mut tx_guard = state.cancel_tx.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock cancel_tx: {}", e))
        })?;
        *tx_guard = None;
    }

    // Phase 3: Insert model message (needs conn lock again)
    let (content, token_count, finish_reason) = match stream_result {
        Ok(result) => (
            result.content,
            result.token_count,
            result.finish_reason.unwrap_or_else(|| "STOP".to_string()),
        ),
        Err(LoomError::GenerationCancelled) => {
            // Save partial content — we don't have the accumulated text here
            // since the error was returned. Use empty content with ERROR reason.
            (String::new(), None, "ERROR".to_string())
        }
        Err(e) => return Err(e),
    };

    let model_msg = {
        let conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

        let model_msg = messages::insert_model_message(
            conn,
            &story_id,
            &user_msg.id,
            &content,
            token_count,
            &model_name,
            Some(&finish_reason),
        )?;

        // Persist leaf ID
        messages::set_story_leaf_id(conn, &story_id, &model_msg.id)?;

        // Record usage for rate limiting (only on successful generation)
        if finish_reason != "ERROR" {
            let tokens = token_count.unwrap_or(0);
            rate_limiter::record_usage(conn, tokens)?;
        }

        model_msg
    };

    // Emit stream_done event
    let done = StreamDone {
        message_id: temp_model_id,
        user_msg_id: user_msg.id,
        model_msg: model_msg.clone(),
    };
    let _ = app.emit("stream_done", &done);

    log::info!("Message sent for story {}", story_id);
    Ok(done)
}

/// Cancel an active generation.
#[tauri::command]
async fn cancel_generation(
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let mut tx_guard = state.cancel_tx.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock cancel_tx: {}", e))
    })?;
    if let Some(sender) = tx_guard.take() {
        let _ = sender.send(true);
        log::info!("Generation cancelled");
    }
    Ok(())
}

/// Load story messages (branch from root → leaf) + sibling counts.
#[tauri::command]
async fn load_story_messages(
    state: tauri::State<'_, AppState>,
    story_id: String,
    leaf_id: String,
) -> Result<StoryPayload, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    messages::load_story_messages(conn, &story_id, &leaf_id)
}

/// Get the persisted leaf ID for a story.
#[tauri::command]
async fn get_story_leaf_id(
    state: tauri::State<'_, AppState>,
    story_id: String,
) -> Result<Option<String>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    messages::get_story_leaf_id(conn, &story_id)
}

// ─── Phase 7: Branching Commands ─────────────────────────────────────────────

/// Get sibling IDs and current index for a message.
#[tauri::command]
async fn get_siblings(
    state: tauri::State<'_, AppState>,
    story_id: String,
    parent_id: Option<String>,
    current_id: String,
) -> Result<(Vec<String>, usize), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    messages::get_siblings(conn, &story_id, parent_id.as_deref(), &current_id)
}

/// Navigate to a sibling: find the deepest leaf from the sibling and return the full branch.
#[tauri::command]
async fn navigate_to_sibling(
    state: tauri::State<'_, AppState>,
    story_id: String,
    sibling_id: String,
) -> Result<StoryPayload, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    let leaf_id = messages::find_deepest_leaf(conn, &story_id, &sibling_id)?;
    messages::set_story_leaf_id(conn, &story_id, &leaf_id)?;
    messages::load_story_messages(conn, &story_id, &leaf_id)
}

/// Soft-delete a message pair (AI + its parent user msg if it's the last pair).
/// Returns the new leaf_id after deletion.
#[tauri::command]
async fn delete_message(
    state: tauri::State<'_, AppState>,
    story_id: String,
    message_id: String,
) -> Result<Option<String>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

    // Get the message to find its parent (user msg)
    let msg = messages::get_message(conn, &message_id)?;
    let parent_id = msg.parent_id.clone();

    // Soft-delete the AI message
    messages::soft_delete_message(conn, &message_id)?;

    // Also soft-delete the parent user message if it has no other non-deleted children
    if let Some(ref uid) = parent_id {
        let other_children: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE parent_id = ?1 AND deleted_at IS NULL",
            rusqlite::params![uid],
            |row| row.get(0),
        )?;
        if other_children == 0 {
            messages::soft_delete_message(conn, uid)?;
            // New leaf is the user message's parent
            let user_msg = messages::get_message(conn, uid)?;
            if let Some(ref new_leaf) = user_msg.parent_id {
                messages::set_story_leaf_id(conn, &story_id, new_leaf)?;
                return Ok(Some(new_leaf.clone()));
            } else {
                // Was the root — no messages left
                return Ok(None);
            }
        }
    }

    // AI message deleted but user message has other children — leaf becomes parent user msg
    if let Some(ref uid) = parent_id {
        messages::set_story_leaf_id(conn, &story_id, uid)?;
        return Ok(Some(uid.clone()));
    }
    Ok(None)
}

/// Undo soft-delete of message(s).
#[tauri::command]
async fn undelete_message(
    state: tauri::State<'_, AppState>,
    message_ids: Vec<String>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    for id in &message_ids {
        messages::undelete_message(conn, id)?;
    }
    Ok(())
}

/// Set the leaf ID for a story (exposed for frontend persistence).
#[tauri::command]
async fn set_story_leaf_id(
    state: tauri::State<'_, AppState>,
    story_id: String,
    leaf_id: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    messages::set_story_leaf_id(conn, &story_id, &leaf_id)
}

/// Get a single message by ID.
#[tauri::command]
async fn get_message(
    state: tauri::State<'_, AppState>,
    message_id: String,
) -> Result<ChatMessage, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    messages::get_message(conn, &message_id)
}

// ─── Phase 8: Settings ────────────────────────────────────────────────────────

/// Get all settings as a key-value map.
#[tauri::command]
async fn get_settings_all(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| LoomError::Internal(format!("Settings row error: {}", e)))?;
        map.insert(k, v);
    }
    Ok(map)
}

/// Save a single setting.
#[tauri::command]
async fn save_setting(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Sync accent color to world_meta.json for World Picker display.
#[tauri::command]
async fn sync_accent_to_world_meta(
    state: tauri::State<'_, AppState>,
    hex: String,
) -> Result<(), LoomError> {
    let world_id = {
        let guard = state.active_world_id.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock world_id: {}", e))
        })?;
        guard.clone().ok_or(LoomError::NoActiveConnection)?
    };
    let mut meta = world::read_world_meta(&world_id)?;
    meta.accent_color = hex;
    meta.modified_at = chrono::Utc::now().to_rfc3339();
    let world_dir = world::world_dir_path(&world_id)?;
    world::write_world_meta_atomic(&world_dir, &meta)?;
    Ok(())
}

/// Reset rate limiter counters.
#[tauri::command]
async fn reset_rate_limiter(
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    rate_limiter::reset_counters(conn)
}

/// Get current telemetry counters for the frontend.
#[tauri::command]
async fn get_telemetry(
    state: tauri::State<'_, AppState>,
) -> Result<rate_limiter::TelemetryCounters, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    rate_limiter::get_telemetry(conn)
}

/// Check if a request can proceed under rate limits.
#[tauri::command]
async fn check_rate_limit(
    state: tauri::State<'_, AppState>,
) -> Result<rate_limiter::RateLimitStatus, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    rate_limiter::check_rate_limit(conn)
}

/// Check if API key is set (without exposing the actual key).
#[tauri::command]
async fn has_api_key(
    state: tauri::State<'_, AppState>,
) -> Result<bool, LoomError> {
    let guard = state.api_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock api_key: {}", e))
    })?;
    Ok(guard.is_some())
}

/// Change the master password — Amendment A6.
/// Verifies old password, generates new salt + key + sentinel, re-keys all world DBs.
#[tauri::command]
async fn change_master_password(
    state: tauri::State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), LoomError> {
    use zeroize::Zeroize;

    // 1. Read current config and verify old password
    let mut app_config = config::read_app_config()?;
    let old_salt = hex::decode(&app_config.pbkdf2_salt_hex)?;
    let mut old_key = crypto::derive_key(&old_password, &old_salt, app_config.pbkdf2_iterations);

    if !crypto::verify_sentinel(&old_key, &app_config.key_check) {
        old_key.zeroize();
        return Err(LoomError::IncorrectPassword);
    }

    // 2. Generate new salt, derive new key, create new sentinel (Amendment A6: new salt every change)
    let new_salt = crypto::generate_salt();
    let new_key = crypto::derive_key(&new_password, &new_salt, config::DEFAULT_PBKDF2_ITERATIONS);
    let new_sentinel = crypto::create_sentinel(&new_key)?;

    // 3. Close the active DB connection before re-keying
    {
        let mut conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        *conn_guard = None;
    }

    // 4. Re-key every (non-deleted) world database
    let new_key_hex = hex::encode(&new_key);
    for world_entry in &app_config.worlds {
        if world_entry.deleted_at.is_some() {
            continue;
        }

        let data_dir = config::app_data_dir()?;
        let db_path = data_dir.join("worlds").join(&world_entry.id).join("loom.db");
        if !db_path.exists() {
            continue;
        }

        // Open with old key, then rekey to new key
        let conn = db::open_world_db(&db_path, &old_key)?;
        conn.execute_batch(&format!("PRAGMA rekey = \"x'{new_key_hex}'\";"))
            .map_err(|e| LoomError::Database(format!("Failed to rekey world {}: {}", world_entry.id, e)))?;
        // Connection is dropped here, closing the DB
    }

    // 5. Update app_config.json atomically
    app_config.pbkdf2_salt_hex = hex::encode(new_salt);
    app_config.pbkdf2_iterations = config::DEFAULT_PBKDF2_ITERATIONS;
    app_config.key_check = new_sentinel;
    config::write_app_config_atomic(&app_config)?;

    // 6. Update master key in AppState
    {
        let mut key_guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master_key: {}", e))
        })?;
        if let Some(ref mut k) = *key_guard {
            k.zeroize();
        }
        *key_guard = Some(new_key);
    }

    // 7. Re-open the active world DB with the new key
    let active_world_id = {
        let guard = state.active_world_id.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock active_world_id: {}", e))
        })?;
        guard.clone()
    };

    if let Some(wid) = active_world_id {
        let data_dir = config::app_data_dir()?;
        let db_path = data_dir.join("worlds").join(&wid).join("loom.db");
        if db_path.exists() {
            let conn = db::open_world_db(&db_path, &new_key)?;
            let mut conn_guard = state.active_conn.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock connection: {}", e))
            })?;
            *conn_guard = Some(conn);
        }
    }

    // 8. Zero old key material
    old_key.zeroize();

    log::info!("Master password changed successfully");
    Ok(())
}

// ─── Phase 9: Control Pane ────────────────────────────────────────────────────

/// Update an item's description field.
#[tauri::command]
async fn update_item_description(
    state: tauri::State<'_, AppState>,
    id: String,
    description: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    conn.execute(
        "UPDATE items SET description = ?1, modified_at = ?2 WHERE id = ?3",
        rusqlite::params![description, chrono::Utc::now().to_rfc3339(), id],
    )?;
    Ok(())
}

/// Get story settings (per-story key-value pairs from story_settings table).
#[tauri::command]
async fn get_story_settings(
    state: tauri::State<'_, AppState>,
    story_id: String,
) -> Result<std::collections::HashMap<String, String>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    let mut stmt = conn.prepare("SELECT key, value FROM story_settings WHERE story_id = ?1")?;
    let rows = stmt.query_map(rusqlite::params![story_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| LoomError::Internal(format!("Story settings row error: {}", e)))?;
        map.insert(k, v);
    }
    Ok(map)
}

/// Save a story setting.
#[tauri::command]
async fn save_story_setting(
    state: tauri::State<'_, AppState>,
    story_id: String,
    key: String,
    value: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    conn.execute(
        "INSERT OR REPLACE INTO story_settings (story_id, key, value) VALUES (?1, ?2, ?3)",
        rusqlite::params![story_id, key, value],
    )?;
    Ok(())
}

/// Update user_feedback on a message.
#[tauri::command]
async fn update_message_feedback(
    state: tauri::State<'_, AppState>,
    message_id: String,
    feedback: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    conn.execute(
        "UPDATE messages SET user_feedback = ?1 WHERE id = ?2",
        rusqlite::params![feedback, message_id],
    )?;
    Ok(())
}

/// Get branch count for a story (total branches = number of fork points + 1).
#[tauri::command]
async fn get_branch_info(
    state: tauri::State<'_, AppState>,
    story_id: String,
) -> Result<(i64, i64), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

    // Count total leaf nodes (messages with no children) as branch count
    let branch_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages m
         WHERE m.story_id = ?1 AND m.deleted_at IS NULL
         AND NOT EXISTS (
             SELECT 1 FROM messages c
             WHERE c.parent_id = m.id AND c.story_id = ?1 AND c.deleted_at IS NULL
         )",
        rusqlite::params![story_id],
        |row| row.get(0),
    ).unwrap_or(0);

    // Count total messages as depth proxy
    let total_messages: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE story_id = ?1 AND deleted_at IS NULL",
        rusqlite::params![story_id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok((branch_count, total_messages))
}

// ─── Phase 9: Context Doc Attachment ──────────────────────────────────────────

/// Attach a source document to a story as a context doc.
#[tauri::command]
async fn attach_context_doc(
    state: tauri::State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::attach_context_doc(conn, &story_id, &doc_id)
}

/// Detach a context doc from a story.
#[tauri::command]
async fn detach_context_doc(
    state: tauri::State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::detach_context_doc(conn, &story_id, &doc_id)
}

/// Get all attached context docs for a story.
#[tauri::command]
async fn get_context_docs(
    state: tauri::State<'_, AppState>,
    story_id: String,
) -> Result<Vec<ContextDoc>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::get_context_docs(conn, &story_id)
}

// ─── Phase 11: Source Document Editor + Templates ─────────────────────────────

/// Get a single vault item including its content.
#[tauri::command]
async fn vault_get_item(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<VaultItem, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::get_item(conn, &id)
}

/// Update a vault item's content (doc editor save).
#[tauri::command]
async fn vault_update_item_content(
    state: tauri::State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::update_item_content(conn, &id, &content)
}

/// Create a vault item with initial content (template-based).
#[tauri::command]
async fn vault_create_item_with_content(
    item_type: String,
    name: String,
    parent_id: Option<String>,
    subtype: Option<String>,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<VaultItemMeta, LoomError> {
    if name.trim().is_empty() {
        return Err(LoomError::Validation("Item name cannot be empty.".into()));
    }
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::create_item_with_content(conn, &item_type, name.trim(), parent_id.as_deref(), subtype.as_deref(), &content)
}

/// List all templates.
#[tauri::command]
async fn list_templates(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Template>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::list_templates(conn)
}

/// Save (create or update) a template.
#[tauri::command]
async fn save_template(
    state: tauri::State<'_, AppState>,
    template: Template,
) -> Result<Template, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::save_template(conn, &template)
}

/// Delete a template.
#[tauri::command]
async fn delete_template(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::delete_template(conn, &id)
}

// ─── Phase 12: Ghostwriter ────────────────────────────────────────────────────

/// Ghostwriter result returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct GhostwriterResult {
    new_content: String,
    token_count: u32,
}

/// Ghostwriter edit history entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct GhostwriterEditRecord {
    edited_at: String,
    original_content: String,
    new_content: String,
    instruction: String,
    selected_text: String,
}

/// Send a Ghostwriter revision request — Doc 16 §3.
/// Non-streamed: returns the complete revised message.
#[tauri::command]
async fn send_ghostwriter_request(
    state: tauri::State<'_, AppState>,
    message_id: String,
    selected_text: String,
    instruction: String,
    original_content: String,
    story_id: String,
    leaf_id: String,
) -> Result<GhostwriterResult, LoomError> {
    // Get API key
    let api_key = {
        let guard = state.api_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock api key: {}", e))
        })?;
        guard.clone().ok_or(LoomError::ApiKeyMissing)?
    };

    // Phase 1: Load history and settings (needs conn lock)
    let (history, prompt_template, model_name) = {
        let conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

        // Check rate limit
        let status = rate_limiter::check_rate_limit(conn)?;
        if !status.can_proceed {
            return Err(LoomError::RateLimitExceeded);
        }

        // Load history up to but NOT including the AI message being edited.
        // We need the parent user message's parent_id to reconstruct the branch.
        let ai_msg = messages::get_message(conn, &message_id)?;
        let history = if let Some(ref parent_user_id) = ai_msg.parent_id {
            // Get the user message's parent (grandparent of AI msg)
            let user_msg = messages::get_message(conn, parent_user_id)?;
            if let Some(ref grandparent_id) = user_msg.parent_id {
                let payload = messages::load_story_messages(conn, &story_id, grandparent_id)?;
                payload.messages
            } else {
                vec![]
            }
        } else {
            vec![]
        };

        // Read ghostwriter prompt template
        let prompt: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'prompt_ghostwriter'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| DEFAULT_GHOSTWRITER_PROMPT.to_string());

        let model: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'text_model_name'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "gemini-2.5-flash".to_string());

        (history, prompt, model)
    }; // conn lock dropped

    // Phase 2: Build request and call API (non-streamed)
    let request_body = gemini::build_ghostwriter_request(
        &prompt_template,
        &history,
        &selected_text,
        &instruction,
        &original_content,
    );

    let (content, token_count) = gemini::generate_non_streaming(
        &api_key,
        &model_name,
        &request_body,
    )
    .await?;

    // Record usage
    {
        let conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
        let tokens = token_count.unwrap_or(0);
        rate_limiter::record_usage(conn, tokens)?;
    }

    log::info!("Ghostwriter request completed for message {}", message_id);
    Ok(GhostwriterResult {
        new_content: content,
        token_count: token_count.unwrap_or(0) as u32,
    })
}

/// Save a Ghostwriter edit — update message content and append to history.
#[tauri::command]
async fn save_ghostwriter_edit(
    state: tauri::State<'_, AppState>,
    message_id: String,
    new_content: String,
    history_entry: GhostwriterEditRecord,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

    // Read current history
    let current_history_json: String = conn
        .query_row(
            "SELECT ghostwriter_history FROM messages WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![message_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    let mut history: Vec<GhostwriterEditRecord> =
        serde_json::from_str(&current_history_json).unwrap_or_default();

    // If this is a revert (instruction == "[revert]"), pop the last entry instead of appending
    if history_entry.instruction == "[revert]" {
        history.pop();
    } else {
        history.push(history_entry);
    }

    let updated_json = serde_json::to_string(&history)
        .map_err(|e| LoomError::Internal(format!("JSON serialize error: {}", e)))?;

    conn.execute(
        "UPDATE messages SET content = ?1, ghostwriter_history = ?2 WHERE id = ?3",
        rusqlite::params![new_content, updated_json, message_id],
    )?;

    log::info!("Ghostwriter edit saved for message {}", message_id);
    Ok(())
}

/// Default Ghostwriter prompt template — Doc 16 §3.3.
const DEFAULT_GHOSTWRITER_PROMPT: &str = r#"You are assisting a writer with targeted revisions to AI-generated story text.

The writer has selected a specific passage and provided an instruction.
Your task:
1. Rewrite ONLY the marked passage according to the instruction.
2. The rest of the message must remain word-for-word identical.
3. Return the COMPLETE message with the revision applied.
4. Do not add commentary, preamble, or explanation — return only the full revised message text.

Selected passage:
<<<SELECTED>>>
{selected_text}
<<<END>>>

Writer's instruction:
{instruction}

Original message (return this in full with only the selected passage changed):
{original_message_content}"#;

// ─── App Setup ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            check_app_config,
            create_app_config,
            create_world,
            list_worlds,
            unlock_vault,
            lock_vault,
            validate_and_store_api_key,
            save_api_key_to_db,
            generate_recovery_file,
            restore_app_config,
            // Phase 4A: World management
            switch_world,
            rename_world,
            delete_world,
            restore_world,
            purge_world,
            list_deleted_worlds,
            // Phase 4A: Vault item CRUD
            vault_list_items,
            vault_list_trash,
            vault_create_item,
            vault_rename_item,
            vault_move_item,
            vault_soft_delete,
            vault_restore_item,
            vault_purge_item,
            vault_update_sort_order,
            // Phase 6: Conversation engine
            send_message,
            cancel_generation,
            load_story_messages,
            get_story_leaf_id,
            // Phase 7: Branching
            get_siblings,
            navigate_to_sibling,
            delete_message,
            undelete_message,
            set_story_leaf_id,
            get_message,
            // Phase 8: Settings
            get_settings_all,
            save_setting,
            sync_accent_to_world_meta,
            reset_rate_limiter,
            get_telemetry,
            check_rate_limit,
            has_api_key,
            change_master_password,
            // Phase 9: Control Pane
            update_item_description,
            get_story_settings,
            save_story_setting,
            update_message_feedback,
            get_branch_info,
            // Phase 9: Context Doc Attachment
            attach_context_doc,
            detach_context_doc,
            get_context_docs,
            // Phase 11: Source Document Editor + Templates
            vault_get_item,
            vault_update_item_content,
            vault_create_item_with_content,
            list_templates,
            save_template,
            delete_template,
            // Phase 12: Ghostwriter
            send_ghostwriter_request,
            save_ghostwriter_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LOOM");
}
