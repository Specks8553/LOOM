//! History assembly (Doc 15 §History Assembly, Doc 05 §services/history.rs).
//!
//! Architecture Wall #1 lives here: the frontend never assembles history;
//! the backend reconstructs the linear list, injects feedback, substitutes
//! Accordion fake-pairs (Phase 7), and emits a Gemini-shaped `Vec<Content>`.
//!
//! v2.0 Phase 3 implements the **story** branch end-to-end. The handover
//! and consulting branches of `ConversationMode` are stubbed to a stable
//! `LoomError::Internal("not yet implemented")` so Phase 4 can swap them in
//! additively without changing call sites.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::conversation_sessions::get_session;
use crate::db::messages::{
    get_message, list_session_messages, list_story_messages, list_story_messages_up_to, ChatMessage,
};
use crate::error::LoomError;

/// Which conversation a `send_message` call is targeting. Story is the only
/// branch implemented in Phase 3; the others land in Phase 4 (Doc 23).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversationMode {
    Story,
    Handover,
    Consulting,
}

/// Parsed `UserContent` per Doc 03 §TypeScript Interfaces. Stored in
/// `messages.content` as JSON when `content_type = 'json_user'`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct UserContent {
    pub plot_direction: String,
    pub background_information: String,
    pub modificators: Vec<String>,
    pub constraints: String,
}

/// One Gemini API `Content` entry. Matches the JSON shape Gemini expects
/// inside `contents: [...]`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiContent {
    pub role: String, // "user" | "model"
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiPart {
    /// Plain-text part. Empty when `file_data` is set; serde drops empty
    /// strings so the wire body stays clean.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// Reference to a file uploaded to Gemini's File API (Doc 22 §Image
    /// source documents). Mutually exclusive with `text`.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "fileData")]
    pub file_data: Option<GeminiFileData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiFileData {
    #[serde(rename = "fileUri")]
    pub file_uri: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

impl GeminiPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            file_data: None,
        }
    }
    pub fn file(uri: impl Into<String>, mime: impl Into<String>) -> Self {
        Self {
            text: String::new(),
            file_data: Some(GeminiFileData {
                file_uri: uri.into(),
                mime_type: mime.into(),
            }),
        }
    }
}

impl GeminiContent {
    fn user(text: String) -> Self {
        Self {
            role: "user".into(),
            parts: vec![GeminiPart::text(text)],
        }
    }
    fn model(text: String) -> Self {
        Self {
            role: "model".into(),
            parts: vec![GeminiPart::text(text)],
        }
    }
}

/// Render a `UserContent` value into the bracketed-text format Doc 15
/// §History Assembly defines. Empty fields are omitted (no empty section
/// headers) so the model never sees a stray `[BACKGROUND INFORMATION]`
/// followed by an empty line.
pub fn render_user_content(content: &UserContent) -> String {
    let mut out = String::new();
    if !content.plot_direction.trim().is_empty() {
        out.push_str("[PLOT DIRECTION]\n");
        out.push_str(content.plot_direction.trim_end());
        out.push('\n');
    }
    if !content.background_information.trim().is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("[BACKGROUND INFORMATION — NOT FOR THE READER]\n");
        out.push_str(content.background_information.trim_end());
        out.push('\n');
    }
    if !content.modificators.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("[MODIFICATORS]\n");
        out.push_str(&content.modificators.join(", "));
        out.push('\n');
    }
    if !content.constraints.trim().is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\n");
        out.push_str(content.constraints.trim_end());
        out.push('\n');
    }
    // Trim a trailing newline so the bracketed block renders cleanly when
    // it becomes a Gemini part.
    while out.ends_with('\n') {
        out.pop();
    }
    out
}

/// Append the writer's feedback to a model message's stored text per
/// Doc 15 §History Assembly. Empty feedback is a no-op.
pub(crate) fn append_feedback(content: &str, feedback: Option<&str>) -> String {
    match feedback {
        Some(fb) if !fb.is_empty() => format!("{content}\n\n[WRITER FEEDBACK]\n{fb}"),
        _ => content.to_owned(),
    }
}

/// Wrap the current user turn in the aux-slot envelope per Doc 15 §Aux Slot
/// Injection. When `aux` is empty the bare bracketed user content is
/// returned untouched.
fn apply_aux(rendered_user_turn: &str, aux: &str) -> String {
    let aux_trimmed = aux.trim();
    if aux_trimmed.is_empty() {
        return rendered_user_turn.to_owned();
    }
    format!("[AUX — ALWAYS APPLY]\n{aux_trimmed}\n\n[USER]\n{rendered_user_turn}")
}

/// Output of `assemble_request` — what `services/gemini.rs::stream_generate`
/// needs to issue the call.
///
/// `cached_content_name`, when set, names a Gemini `cachedContents/...`
/// resource. The wire body emits `cachedContent` in place of the cached
/// prefix; `contents` then carries only the post-cache delta (any uncached
/// story messages plus the current user turn) and the top-level
/// `systemInstruction` is omitted (the SI is baked into the cache).
#[derive(Debug, Clone)]
pub struct AssembledRequest {
    pub system_instruction: String,
    pub contents: Vec<GeminiContent>,
    pub cached_content_name: Option<String>,
}

/// Inputs for story-mode assembly. Caller (the conversation command) is
/// responsible for resolving the settings cascade and filling these in.
pub struct AssembleInputs<'a> {
    pub story_id: &'a str,
    pub draft: &'a UserContent,
    pub system_instruction: &'a str,
    /// Optional aux-slot text. Empty string means no aux injection.
    pub aux_text: &'a str,
}

/// Build the Gemini request payload for a story-mode send.
///
/// Steps:
/// 1. Load every `kind='story'` message for this story, chronological.
/// 2. For each historical user message: parse `json_user`, re-render as
///    bracketed text. Past constraints stay in history (Doc 15).
/// 3. For each historical model message: append feedback if present.
/// 4. Append the current user turn, optionally aux-wrapped.
pub fn assemble_story_request(
    conn: &Connection,
    inputs: AssembleInputs<'_>,
) -> Result<AssembledRequest, LoomError> {
    let history = list_story_messages(conn, inputs.story_id)?;
    let mut contents: Vec<GeminiContent> = Vec::with_capacity(history.len() + 1);

    for msg in &history {
        match msg.role.as_str() {
            "user" => {
                let parsed = parse_user_content(msg)?;
                let rendered = render_user_content(&parsed);
                if !rendered.is_empty() {
                    contents.push(GeminiContent::user(rendered));
                }
            }
            "model" => {
                let with_feedback = append_feedback(&msg.content, msg.user_feedback.as_deref());
                contents.push(GeminiContent::model(with_feedback));
            }
            other => {
                return Err(LoomError::Internal(format!(
                    "unexpected message role '{other}' on message {}",
                    msg.id
                )));
            }
        }
    }

    let current_turn = render_user_content(inputs.draft);
    if current_turn.trim().is_empty() {
        return Err(LoomError::validation("Plot direction is required to send."));
    }
    let final_user = apply_aux(&current_turn, inputs.aux_text);
    contents.push(GeminiContent::user(final_user));

    Ok(AssembledRequest {
        system_instruction: inputs.system_instruction.to_owned(),
        contents,
        cached_content_name: None,
    })
}

fn parse_user_content(msg: &ChatMessage) -> Result<UserContent, LoomError> {
    if msg.content_type != "json_user" {
        return Err(LoomError::Internal(format!(
            "user message {} has unexpected content_type '{}'",
            msg.id, msg.content_type
        )));
    }
    serde_json::from_str::<UserContent>(&msg.content).map_err(LoomError::from)
}

/// Mode-aware entry point. Phase 4 wires the session branches via
/// [`assemble_session_request`]; the mode router stays for callers that hold
/// a `ConversationMode` value, even though `commands/modes.rs` dispatches
/// against the session function directly.
pub fn assemble_request(
    conn: &Connection,
    mode: ConversationMode,
    inputs: AssembleInputs<'_>,
) -> Result<AssembledRequest, LoomError> {
    match mode {
        ConversationMode::Story => assemble_story_request(conn, inputs),
        ConversationMode::Handover | ConversationMode::Consulting => Err(LoomError::Internal(
            "session-mode assembly must go through assemble_session_request".into(),
        )),
    }
}

// --- Session-mode assembly (Phase 4) ----------------------------------------

/// Inputs for handover / consulting assembly. The "draft" is a single text
/// string (Doc 23 — one free-text field for both session modes). Per Doc 23
/// §History scope:
///   - Handover: SI + story-up-to-entry + this session's prior turns + new
///     user turn.
///   - Consulting: same shape; the difference is which SI is in `system_instruction`
///     and whether a cache wraps the prefix at Gemini-call time (Phase 6).
pub struct SessionAssembleInputs<'a> {
    pub session_id: &'a str,
    pub user_text: &'a str,
    pub system_instruction: &'a str,
}

/// Build a Gemini request for a handover / consulting turn.
///
/// 1. Load the session row → know story_id, entry_message_id, kind.
/// 2. Load story-kind messages with `created_at <= entry_message.created_at`,
///    rendered the same way story history is (user re-bracketed, model
///    feedback-appended).
/// 3. Append this session's prior turns (plain text).
/// 4. Append the new user turn (plain text — no aux, no bracket envelope).
pub fn assemble_session_request(
    conn: &Connection,
    inputs: SessionAssembleInputs<'_>,
) -> Result<AssembledRequest, LoomError> {
    let user_text = inputs.user_text.trim();
    if user_text.is_empty() {
        return Err(LoomError::validation("Session input is required to send."));
    }

    let session = get_session(conn, inputs.session_id)?
        .ok_or_else(|| LoomError::NotFound(format!("session {} not found", inputs.session_id)))?;

    // Story-up-to-entry boundary. NULL entry_message_id = session started on
    // an empty story → no story history.
    let boundary = if let Some(entry_id) = &session.entry_message_id {
        match get_message(conn, entry_id)? {
            Some(m) => Some(m.created_at),
            // Entry message hard-deleted between session creation and now —
            // proceed with the messages that still survive. Doc 22's
            // divergence-toast path applies in Phase 6 when the cache is
            // rebuilt; for plain inline assembly we just skip the bound and
            // include nothing (the snapshot's `story_message_ids` is the
            // authoritative list once Phase 6 wires it).
            None => None,
        }
    } else {
        None
    };

    let mut contents: Vec<GeminiContent> = Vec::new();
    let story_history = list_story_messages_up_to(conn, &session.story_id, boundary.as_deref())?;
    for msg in &story_history {
        match msg.role.as_str() {
            "user" => {
                let parsed = parse_user_content(msg)?;
                let rendered = render_user_content(&parsed);
                if !rendered.is_empty() {
                    contents.push(GeminiContent::user(rendered));
                }
            }
            "model" => {
                let with_feedback = append_feedback(&msg.content, msg.user_feedback.as_deref());
                contents.push(GeminiContent::model(with_feedback));
            }
            other => {
                return Err(LoomError::Internal(format!(
                    "unexpected message role '{other}' on message {}",
                    msg.id
                )));
            }
        }
    }

    // Session prior turns. Plain text — both handover and consulting use a
    // single free-text field, persisted as `content_type = 'text'`.
    let session_history = list_session_messages(conn, inputs.session_id)?;
    for msg in &session_history {
        match msg.role.as_str() {
            "user" => contents.push(GeminiContent::user(msg.content.clone())),
            "model" => contents.push(GeminiContent::model(append_feedback(
                &msg.content,
                msg.user_feedback.as_deref(),
            ))),
            other => {
                return Err(LoomError::Internal(format!(
                    "unexpected session message role '{other}' on {}",
                    msg.id
                )));
            }
        }
    }

    contents.push(GeminiContent::user(user_text.to_owned()));

    Ok(AssembledRequest {
        system_instruction: inputs.system_instruction.to_owned(),
        contents,
        cached_content_name: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{insert_message, ChatMessage};
    use crate::db::migrations::{apply_pending, MigrationRoot};
    use rusqlite::Connection;

    fn fresh_conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'Test', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    fn user_row(id: &str, created_at: &str, content: &UserContent) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: serde_json::to_string(content).unwrap(),
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

    fn model_row(id: &str, created_at: &str, text: &str, feedback: Option<&str>) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "model".into(),
            content_type: "text".into(),
            content: text.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: feedback.map(str::to_owned),
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    #[test]
    fn render_user_content_omits_empty_sections() {
        let c = UserContent {
            plot_direction: "Open with rain.".into(),
            background_information: "".into(),
            modificators: vec![],
            constraints: "no dialogue".into(),
        };
        let out = render_user_content(&c);
        assert!(out.contains("[PLOT DIRECTION]"));
        assert!(!out.contains("[BACKGROUND INFORMATION"));
        assert!(!out.contains("[MODIFICATORS]"));
        assert!(out.contains("[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]"));
    }

    #[test]
    fn render_user_content_joins_modificators_with_commas() {
        let c = UserContent {
            plot_direction: "x".into(),
            background_information: "".into(),
            modificators: vec!["noir".into(), "tight".into(), "present tense".into()],
            constraints: "".into(),
        };
        let out = render_user_content(&c);
        assert!(out.contains("noir, tight, present tense"));
    }

    #[test]
    fn append_feedback_inserts_marker_when_present() {
        let out = append_feedback("scene text", Some("more dialogue"));
        assert_eq!(out, "scene text\n\n[WRITER FEEDBACK]\nmore dialogue");
    }

    #[test]
    fn append_feedback_passthrough_when_empty() {
        assert_eq!(append_feedback("scene text", None), "scene text");
        assert_eq!(append_feedback("scene text", Some("")), "scene text");
    }

    #[test]
    fn apply_aux_wraps_when_aux_non_empty() {
        let wrapped = apply_aux("[PLOT DIRECTION]\nx", "always do Y");
        assert!(wrapped.starts_with("[AUX — ALWAYS APPLY]\nalways do Y\n\n[USER]\n"));
        assert!(wrapped.ends_with("[PLOT DIRECTION]\nx"));
    }

    #[test]
    fn apply_aux_passthrough_when_aux_empty() {
        assert_eq!(apply_aux("body", ""), "body");
        assert_eq!(apply_aux("body", "   "), "body");
    }

    #[test]
    fn assemble_story_request_includes_history_then_current_turn() {
        let c = fresh_conn();
        let u1_content = UserContent {
            plot_direction: "First turn".into(),
            ..Default::default()
        };
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z", &u1_content)).unwrap();
        insert_message(
            &c,
            &model_row(
                "m1",
                "2026-01-01T00:00:02Z",
                "First response",
                Some("more grit"),
            ),
        )
        .unwrap();

        let draft = UserContent {
            plot_direction: "Second turn".into(),
            ..Default::default()
        };
        let req = assemble_story_request(
            &c,
            AssembleInputs {
                story_id: "story1",
                draft: &draft,
                system_instruction: "be helpful",
                aux_text: "",
            },
        )
        .unwrap();

        assert_eq!(req.system_instruction, "be helpful");
        assert_eq!(req.contents.len(), 3);
        assert_eq!(req.contents[0].role, "user");
        assert!(req.contents[0].parts[0].text.contains("First turn"));
        assert_eq!(req.contents[1].role, "model");
        assert!(req.contents[1].parts[0].text.contains("First response"));
        assert!(req.contents[1].parts[0].text.contains("[WRITER FEEDBACK]"));
        assert_eq!(req.contents[2].role, "user");
        assert!(req.contents[2].parts[0].text.contains("Second turn"));
    }

    #[test]
    fn assemble_story_request_rejects_empty_plot_direction() {
        let c = fresh_conn();
        let draft = UserContent::default();
        let err = assemble_story_request(
            &c,
            AssembleInputs {
                story_id: "story1",
                draft: &draft,
                system_instruction: "",
                aux_text: "",
            },
        )
        .unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn assemble_request_routes_session_modes_to_dedicated_entrypoint() {
        // `assemble_request` is for story-mode callers; session callers must
        // use `assemble_session_request` directly (Phase 4 — Doc 23).
        let c = fresh_conn();
        let draft = UserContent {
            plot_direction: "x".into(),
            ..Default::default()
        };
        let err = assemble_request(
            &c,
            ConversationMode::Handover,
            AssembleInputs {
                story_id: "story1",
                draft: &draft,
                system_instruction: "",
                aux_text: "",
            },
        )
        .unwrap_err();
        assert!(matches!(err, LoomError::Internal(_)));
    }

    fn insert_session(conn: &Connection, id: &str, kind: &str, entry_message_id: Option<&str>) {
        conn.execute(
            "INSERT INTO conversation_sessions
                (id, story_id, kind, name, entry_message_id, entry_snapshot,
                 created_at, modified_at)
             VALUES (?1, 'story1', ?2, 'S', ?3, '{}',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, kind, entry_message_id],
        )
        .unwrap();
    }

    fn session_msg(
        id: &str,
        session_id: &str,
        kind: &str,
        role: &str,
        text: &str,
        created_at: &str,
    ) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: Some(session_id.into()),
            role: role.into(),
            content_type: "text".into(),
            content: text.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: kind.into(),
        }
    }

    #[test]
    fn assemble_session_request_rejects_empty_user_text() {
        let c = fresh_conn();
        insert_session(&c, "s1", "handover", None);
        let err = assemble_session_request(
            &c,
            SessionAssembleInputs {
                session_id: "s1",
                user_text: "   ",
                system_instruction: "",
            },
        )
        .unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn assemble_session_request_appends_user_turn_to_empty_history() {
        let c = fresh_conn();
        insert_session(&c, "s1", "handover", None);
        let req = assemble_session_request(
            &c,
            SessionAssembleInputs {
                session_id: "s1",
                user_text: "Summarise the story so far.",
                system_instruction: "be an analyst",
            },
        )
        .unwrap();
        assert_eq!(req.system_instruction, "be an analyst");
        assert_eq!(req.contents.len(), 1);
        assert_eq!(req.contents[0].role, "user");
        assert_eq!(req.contents[0].parts[0].text, "Summarise the story so far.");
    }

    #[test]
    fn assemble_session_request_scopes_story_history_to_entry_message() {
        let c = fresh_conn();
        // Story messages: u1 (before entry), m1 (= entry), u2 (after entry).
        let u1_c = UserContent {
            plot_direction: "early".into(),
            ..Default::default()
        };
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z", &u1_c)).unwrap();
        insert_message(
            &c,
            &model_row("m1", "2026-01-01T00:00:02Z", "early reply", None),
        )
        .unwrap();
        let u2_c = UserContent {
            plot_direction: "late".into(),
            ..Default::default()
        };
        insert_message(&c, &user_row("u2", "2026-01-01T00:00:03Z", &u2_c)).unwrap();

        // Session anchored at m1 (so u1 + m1 visible, u2 NOT visible).
        insert_session(&c, "s1", "consulting", Some("m1"));

        let req = assemble_session_request(
            &c,
            SessionAssembleInputs {
                session_id: "s1",
                user_text: "Where are we headed?",
                system_instruction: "consult-si",
            },
        )
        .unwrap();
        // u1, m1, current = 3
        assert_eq!(req.contents.len(), 3);
        assert!(req.contents[0].parts[0].text.contains("early"));
        assert_eq!(req.contents[1].role, "model");
        assert!(!req
            .contents
            .iter()
            .any(|c| c.parts[0].text.contains("late")));
        assert_eq!(req.contents[2].parts[0].text, "Where are we headed?");
    }

    #[test]
    fn assemble_session_request_includes_prior_session_turns() {
        let c = fresh_conn();
        insert_session(&c, "s1", "consulting", None);
        // Prior session turns
        insert_message(
            &c,
            &session_msg(
                "sm1",
                "s1",
                "consulting",
                "user",
                "first question",
                "2026-01-01T00:00:01Z",
            ),
        )
        .unwrap();
        insert_message(
            &c,
            &session_msg(
                "sm2",
                "s1",
                "consulting",
                "model",
                "first answer",
                "2026-01-01T00:00:02Z",
            ),
        )
        .unwrap();
        let req = assemble_session_request(
            &c,
            SessionAssembleInputs {
                session_id: "s1",
                user_text: "follow up",
                system_instruction: "",
            },
        )
        .unwrap();
        assert_eq!(req.contents.len(), 3);
        assert_eq!(req.contents[0].parts[0].text, "first question");
        assert_eq!(req.contents[1].parts[0].text, "first answer");
        assert_eq!(req.contents[2].parts[0].text, "follow up");
    }

    #[test]
    fn assemble_session_request_not_found_for_unknown_session() {
        let c = fresh_conn();
        let err = assemble_session_request(
            &c,
            SessionAssembleInputs {
                session_id: "nope",
                user_text: "x",
                system_instruction: "",
            },
        )
        .unwrap_err();
        assert!(matches!(err, LoomError::NotFound(_)));
    }

    #[test]
    fn assemble_story_request_skips_session_messages() {
        let c = fresh_conn();
        c.execute(
            "INSERT INTO conversation_sessions
                (id, story_id, kind, name, entry_snapshot, created_at, modified_at)
             VALUES ('sess1', 'story1', 'consulting', 'C', '{}',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        // Story user turn
        let u1_content = UserContent {
            plot_direction: "story turn".into(),
            ..Default::default()
        };
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z", &u1_content)).unwrap();
        // Consulting message — should be invisible to story assembly.
        let mut sess_msg = user_row("s1", "2026-01-01T00:00:02Z", &u1_content);
        sess_msg.kind = "consulting".into();
        sess_msg.session_id = Some("sess1".into());
        sess_msg.content_type = "text".into();
        sess_msg.content = "session text".into();
        insert_message(&c, &sess_msg).unwrap();

        let draft = UserContent {
            plot_direction: "next".into(),
            ..Default::default()
        };
        let req = assemble_story_request(
            &c,
            AssembleInputs {
                story_id: "story1",
                draft: &draft,
                system_instruction: "",
                aux_text: "",
            },
        )
        .unwrap();
        // u1 + current turn — session message excluded
        assert_eq!(req.contents.len(), 2);
        assert!(!req
            .contents
            .iter()
            .any(|c| c.parts[0].text.contains("session text")));
    }
}
