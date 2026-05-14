//! Context cache service (Doc 22).
//!
//! Phase 5 lands a single no-op call site — `mark_story_stale` — so every
//! attach / detach / content-edit path in `services/vault.rs` already routes
//! through the cache-stale contract. Phase 6 fills the body (write
//! `cache_state.is_stale = 1`, emit `cache_state_changed`) without changing
//! any call site.
//!
//! Per Doc 05 §Dependency Rules, `services/` may import `db/`, `security/`,
//! and `state/` (read-only). Event emission belongs to the command layer.

use rusqlite::Connection;

use crate::error::LoomError;

/// Mark the story-level cache row as stale. **Phase 5 stub:** the `cache_state`
/// row is not written by Phase 5 (it's created on first cache create in
/// Phase 6), so this is a no-op. Phase 6 replaces the body with the actual
/// `UPDATE cache_state SET is_stale = 1 WHERE story_id = ?` and the matching
/// `cache_state_changed` event emission in `commands/cache.rs`.
///
/// Keeping the signature stable now means Phase 5 attach/detach/content-edit
/// paths can call this immediately, and Phase 6 lands without churning every
/// caller. Doc 22 §Stale Triggers enumerates the trigger surface.
#[allow(unused_variables)]
pub fn mark_story_stale(conn: &Connection, story_id: &str) -> Result<(), LoomError> {
    // Intentional no-op; see module comment.
    Ok(())
}
