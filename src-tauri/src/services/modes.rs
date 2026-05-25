//! Mode session lifecycle (Doc 23 §Session lifecycle, Doc 22 §Session Snapshot).
//!
//! Phase 4 owns the session creation / rename / collapse / delete paths plus
//! the snapshot capture. Consulting cache creation is Phase 6's job — we
//! leave the cache fields NULL here. The snapshot is captured eagerly so
//! Phase 6 can rebuild the cache on session re-entry without re-walking
//! state.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::accordion as db_accordion;
use crate::db::conversation_sessions::{
    count_sessions_by_kind, insert_session, ConversationSession,
};
use crate::db::messages::list_story_messages;
use crate::error::LoomError;

/// Doc 23 enumerates these as `'handover' | 'consulting'`. Story is *not* a
/// session kind — story is the implicit thread on the story item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub enum SessionKind {
    Handover,
    Consulting,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Handover => "handover",
            Self::Consulting => "consulting",
        }
    }

    pub fn default_name_prefix(self) -> &'static str {
        match self {
            Self::Handover => "Handover",
            Self::Consulting => "Consulting",
        }
    }
}

/// Per Doc 22 §Session Snapshot. JSON-serialised into
/// `conversation_sessions.entry_snapshot`. Phase 4 captures it; Phase 6 reads
/// it on re-entry to rebuild the consulting cache prefix.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct SessionSnapshot {
    pub schema_version: u32,
    pub system_instruction: String,
    pub story_message_ids: Vec<String>,
    /// Empty in Phase 4; Phase 7 populates from `checkpoints` + accordion segments.
    pub accordion_state: Vec<AccordionSnapshotEntry>,
    /// Empty in Phase 4; Phase 5 populates from `story_state.context_doc_ids`.
    pub attached_docs: Vec<AttachedDocEntry>,
    pub prefix_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct AccordionSnapshotEntry {
    pub segment_id: String,
    pub is_collapsed: bool,
    pub summary: Option<String>,
    pub summary_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct AttachedDocEntry {
    pub doc_id: String,
    pub content_hash: String,
}

/// SHA-256 over the canonical prefix bytes — used for divergence detection on
/// re-entry. For Phase 4 the inputs are SI + ordered story-message ids; Phase
/// 5 will add attached docs and Phase 7 will add accordion entries to the
/// canonicalisation. Each phase appends fields at the end so old snapshots'
/// hashes stay computable for comparison.
pub fn canonicalise_and_hash(
    system_instruction: &str,
    story_message_ids: &[String],
    accordion: &[AccordionSnapshotEntry],
    attached_docs: &[AttachedDocEntry],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"SI:");
    hasher.update(system_instruction.as_bytes());
    hasher.update(b"\nMSGS:");
    for id in story_message_ids {
        hasher.update(id.as_bytes());
        hasher.update(b"\n");
    }
    hasher.update(b"ACC:");
    for entry in accordion {
        hasher.update(entry.segment_id.as_bytes());
        hasher.update(b":");
        hasher.update(if entry.is_collapsed { b"1" } else { b"0" });
        hasher.update(b":");
        hasher.update(entry.summary_hash.as_deref().unwrap_or("").as_bytes());
        hasher.update(b"\n");
    }
    hasher.update(b"DOCS:");
    for doc in attached_docs {
        hasher.update(doc.doc_id.as_bytes());
        hasher.update(b":");
        hasher.update(doc.content_hash.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

/// Build a fresh `SessionSnapshot` from current story state. Caller resolved
/// the SI from the settings cascade; this function reads story-kind messages
/// and computes the integrity hash.
pub fn build_snapshot(
    conn: &Connection,
    story_id: &str,
    system_instruction: &str,
) -> Result<SessionSnapshot, LoomError> {
    let messages = list_story_messages(conn, story_id)?;
    let story_message_ids: Vec<String> = messages.iter().map(|m| m.id.clone()).collect();
    // Phase 7: capture current accordion state at session-creation time so
    // consulting re-entry rebuilds the prefix against the snapshot — not the
    // current state — per Doc 22 §Session Snapshot + Doc 16 §Modes.
    let accordion_state: Vec<AccordionSnapshotEntry> = db_accordion::list_segments(conn, story_id)?
        .into_iter()
        .map(|seg| {
            let summary_hash = seg.summary.as_deref().map(|s| {
                let mut hasher = Sha256::new();
                hasher.update(s.as_bytes());
                format!("{:x}", hasher.finalize())
            });
            AccordionSnapshotEntry {
                segment_id: seg.id,
                is_collapsed: seg.is_collapsed,
                summary: seg.summary,
                summary_hash,
            }
        })
        .collect();
    let attached_docs: Vec<AttachedDocEntry> = Vec::new();
    let prefix_hash = canonicalise_and_hash(
        system_instruction,
        &story_message_ids,
        &accordion_state,
        &attached_docs,
    );
    Ok(SessionSnapshot {
        schema_version: 1,
        system_instruction: system_instruction.to_owned(),
        story_message_ids,
        accordion_state,
        attached_docs,
        prefix_hash,
    })
}

/// Compute the next monotonic default name for a session of `kind` on
/// `story_id`. Doc 23 §Naming: `"<Kind> <N>"` with N = 1-based, monotonic per
/// story per kind; defaults are stable on rename. We implement "stable" as
/// "next = count(*) + 1" which never re-uses a slot until the table is
/// rewritten — matches the spec for the typical create-then-rename flow.
pub fn next_session_name(
    conn: &Connection,
    story_id: &str,
    kind: SessionKind,
) -> Result<String, LoomError> {
    let existing = count_sessions_by_kind(conn, story_id, kind.as_str())?;
    Ok(format!("{} {}", kind.default_name_prefix(), existing + 1))
}

/// Inputs needed to create a session row. Resolved by the calling command
/// (`commands/modes.rs`) from the settings cascade.
pub struct CreateSessionInputs<'a> {
    pub story_id: &'a str,
    pub kind: SessionKind,
    pub system_instruction: &'a str,
    /// The story-kind message after which the session is anchored. `None` =
    /// session created on an empty story timeline.
    pub entry_message_id: Option<&'a str>,
    pub now_iso: &'a str,
}

/// Compose + persist a new session row. Cache fields stay NULL — Phase 6
/// turns those on for consulting via `update_session_cache`.
pub fn create_session(
    conn: &Connection,
    inputs: CreateSessionInputs<'_>,
) -> Result<ConversationSession, LoomError> {
    let snapshot = build_snapshot(conn, inputs.story_id, inputs.system_instruction)?;
    let snapshot_json = serde_json::to_string(&snapshot)?;
    let name = next_session_name(conn, inputs.story_id, inputs.kind)?;
    let row = ConversationSession {
        id: Uuid::new_v4().to_string(),
        story_id: inputs.story_id.to_owned(),
        kind: inputs.kind.as_str().to_owned(),
        name,
        entry_message_id: inputs.entry_message_id.map(str::to_owned),
        entry_snapshot: snapshot_json,
        is_collapsed: false,
        cache_name: None,
        cache_expiry_at: None,
        cache_is_stale: false,
        created_at: inputs.now_iso.to_owned(),
        modified_at: inputs.now_iso.to_owned(),
    };
    insert_session(conn, &row)?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::insert_message;
    use crate::db::messages::ChatMessage;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'Test', 0,
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    fn user_row(id: &str, created_at: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: r#"{"plot_direction":"x","background_information":"","modificators":[],"constraints":""}"#.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    #[test]
    fn next_session_name_monotonic_per_kind() {
        let c = fresh_conn();
        assert_eq!(
            next_session_name(&c, "story1", SessionKind::Handover).unwrap(),
            "Handover 1"
        );
        // Insert one
        let row = create_session(
            &c,
            CreateSessionInputs {
                story_id: "story1",
                kind: SessionKind::Handover,
                system_instruction: "si",
                entry_message_id: None,
                now_iso: "2026-01-01T00:00:01Z",
            },
        )
        .unwrap();
        assert_eq!(row.name, "Handover 1");
        // Consulting starts at 1 — independent counter per kind
        assert_eq!(
            next_session_name(&c, "story1", SessionKind::Consulting).unwrap(),
            "Consulting 1"
        );
        // Second handover is N+1
        let row2 = create_session(
            &c,
            CreateSessionInputs {
                story_id: "story1",
                kind: SessionKind::Handover,
                system_instruction: "si",
                entry_message_id: None,
                now_iso: "2026-01-01T00:00:02Z",
            },
        )
        .unwrap();
        assert_eq!(row2.name, "Handover 2");
    }

    #[test]
    fn build_snapshot_includes_story_message_ids_in_order() {
        let c = fresh_conn();
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z")).unwrap();
        insert_message(&c, &user_row("u2", "2026-01-01T00:00:02Z")).unwrap();
        let snap = build_snapshot(&c, "story1", "si-text").unwrap();
        assert_eq!(snap.schema_version, 1);
        assert_eq!(snap.system_instruction, "si-text");
        assert_eq!(snap.story_message_ids, vec!["u1", "u2"]);
        assert!(snap.accordion_state.is_empty());
        assert!(snap.attached_docs.is_empty());
        assert_eq!(snap.prefix_hash.len(), 64); // hex SHA-256
    }

    #[test]
    fn prefix_hash_changes_with_message_set() {
        let c = fresh_conn();
        let empty = build_snapshot(&c, "story1", "si").unwrap();
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z")).unwrap();
        let one = build_snapshot(&c, "story1", "si").unwrap();
        assert_ne!(empty.prefix_hash, one.prefix_hash);
    }

    #[test]
    fn prefix_hash_changes_with_system_instruction() {
        let c = fresh_conn();
        let a = build_snapshot(&c, "story1", "si-a").unwrap();
        let b = build_snapshot(&c, "story1", "si-b").unwrap();
        assert_ne!(a.prefix_hash, b.prefix_hash);
    }

    #[test]
    fn create_session_persists_snapshot_as_json() {
        let c = fresh_conn();
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z")).unwrap();
        let row = create_session(
            &c,
            CreateSessionInputs {
                story_id: "story1",
                kind: SessionKind::Consulting,
                system_instruction: "consult-si",
                entry_message_id: Some("u1"),
                now_iso: "2026-01-01T00:00:02Z",
            },
        )
        .unwrap();
        assert_eq!(row.kind, "consulting");
        assert_eq!(row.name, "Consulting 1");
        assert_eq!(row.entry_message_id.as_deref(), Some("u1"));
        let snap: SessionSnapshot = serde_json::from_str(&row.entry_snapshot).unwrap();
        assert_eq!(snap.story_message_ids, vec!["u1"]);
        assert_eq!(snap.system_instruction, "consult-si");
    }
}
