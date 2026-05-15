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

use crate::db::accordion::{self as db_accordion, AccordionSegment, Checkpoint};
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

/// Anchor `created_at` for a checkpoint. The start sentinel has no anchor
/// message; treat its anchor as `""` so it sorts before every real ISO-8601
/// timestamp (matching `db::accordion::find_segment_for_message`).
fn checkpoint_anchor_at<'a>(cp: &'a Checkpoint, messages: &'a [ChatMessage]) -> &'a str {
    match cp.after_message_id.as_deref() {
        None => "",
        Some(mid) => messages
            .iter()
            .find(|m| m.id == mid)
            .map(|m| m.created_at.as_str())
            .unwrap_or(""),
    }
}

/// Substitute closed-segment summaries into a chronological message slice
/// per Doc 16 §History Assembly. For each message whose containing segment
/// has a summary and is either `is_collapsed` or `use_summary`, a single
/// fake-pair (`fake_user_prompt` → `summary`) replaces the entire run of
/// underlying exchanges; the underlying messages are dropped from the output.
/// Messages in the open segment, or in closed segments with no summary,
/// pass through unchanged.
///
/// Pre-computes each segment's `(start_anchor, end_anchor]` window by
/// matching `Checkpoint.after_message_id` against the given `messages` slice.
/// Anchors that aren't present (e.g. session-scoped slices that don't include
/// every story message) fall back to `""`, which makes those segments
/// effectively unbounded on that side — substitution still applies whenever
/// the message's `created_at` falls inside the resolved range.
pub fn build_history_with_accordion(
    branch_messages: &[ChatMessage],
    segments: &[AccordionSegment],
    checkpoints: &[Checkpoint],
    fake_user_prompt: &str,
) -> Result<Vec<GeminiContent>, LoomError> {
    if segments.is_empty() {
        // Fast path — nothing to substitute.
        return render_history_literal(branch_messages);
    }

    // (start_at, end_at, segment) tuples for active substitutions only.
    let mut active: Vec<(String, String, &AccordionSegment)> = Vec::with_capacity(segments.len());
    for seg in segments {
        let active_seg = seg.summary.is_some() && (seg.is_collapsed || seg.use_summary);
        if !active_seg {
            continue;
        }
        let start_cp = checkpoints.iter().find(|c| c.id == seg.start_cp_id);
        let end_cp = checkpoints.iter().find(|c| c.id == seg.end_cp_id);
        let (Some(start_cp), Some(end_cp)) = (start_cp, end_cp) else {
            // Defensive: checkpoint missing — treat as inactive.
            continue;
        };
        let start_at = checkpoint_anchor_at(start_cp, branch_messages).to_owned();
        let end_at = checkpoint_anchor_at(end_cp, branch_messages).to_owned();
        active.push((start_at, end_at, seg));
    }

    let mut out: Vec<GeminiContent> = Vec::with_capacity(branch_messages.len());
    let mut injected: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(active.len());

    for msg in branch_messages {
        // Locate the active segment whose range contains this message.
        let containing = active.iter().find(|(start, end, _)| {
            start.as_str() < msg.created_at.as_str() && msg.created_at.as_str() <= end.as_str()
        });

        if let Some((_, _, seg)) = containing {
            if injected.insert(seg.id.as_str()) {
                out.push(GeminiContent::user(fake_user_prompt.to_owned()));
                out.push(GeminiContent::model(
                    seg.summary.clone().unwrap_or_default(),
                ));
            }
            // Underlying message is covered by the fake-pair — skip.
            continue;
        }

        render_message_into(msg, &mut out)?;
    }

    Ok(out)
}

/// Render a chronological slice with no substitution — the fast path used
/// when a story has no closed segments.
fn render_history_literal(
    branch_messages: &[ChatMessage],
) -> Result<Vec<GeminiContent>, LoomError> {
    let mut out = Vec::with_capacity(branch_messages.len());
    for msg in branch_messages {
        render_message_into(msg, &mut out)?;
    }
    Ok(out)
}

/// Append a single message in its canonical Gemini shape. User turns parse
/// `json_user` and re-render bracketed text; model turns append feedback.
fn render_message_into(msg: &ChatMessage, out: &mut Vec<GeminiContent>) -> Result<(), LoomError> {
    match msg.role.as_str() {
        "user" => {
            let parsed = parse_user_content(msg)?;
            let rendered = render_user_content(&parsed);
            if !rendered.is_empty() {
                out.push(GeminiContent::user(rendered));
            }
        }
        "model" => {
            let with_feedback = append_feedback(&msg.content, msg.user_feedback.as_deref());
            out.push(GeminiContent::model(with_feedback));
        }
        other => {
            return Err(LoomError::Internal(format!(
                "unexpected message role '{other}' on message {}",
                msg.id
            )));
        }
    }
    Ok(())
}

/// Render a session-history slice (handover / consulting). Plain text on
/// both sides; model turns append feedback. Mirrors the inline-loop in
/// `assemble_session_request`.
fn render_session_message_into(
    msg: &ChatMessage,
    out: &mut Vec<GeminiContent>,
) -> Result<(), LoomError> {
    match msg.role.as_str() {
        "user" => out.push(GeminiContent::user(msg.content.clone())),
        "model" => out.push(GeminiContent::model(append_feedback(
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
    Ok(())
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
    /// Resolved `prompt_accordion_fake_user` (Doc 16 §Fake-pair). The user
    /// half of every substituted segment is this text. Empty string is
    /// allowed for the no-segments fast path.
    pub fake_user_prompt: &'a str,
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
    let segments = db_accordion::list_segments(conn, inputs.story_id)?;
    let checkpoints = db_accordion::list_checkpoints(conn, inputs.story_id)?;
    let mut contents =
        build_history_with_accordion(&history, &segments, &checkpoints, inputs.fake_user_prompt)?;

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
    /// Resolved `prompt_accordion_fake_user`. Substitution applies to the
    /// story-up-to-entry slice (Doc 16 §Accordion + Modes — handover and
    /// inline consulting both use the substituted path).
    pub fake_user_prompt: &'a str,
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

    let story_history = list_story_messages_up_to(conn, &session.story_id, boundary.as_deref())?;
    let segments = db_accordion::list_segments(conn, &session.story_id)?;
    let checkpoints = db_accordion::list_checkpoints(conn, &session.story_id)?;
    let mut contents = build_history_with_accordion(
        &story_history,
        &segments,
        &checkpoints,
        inputs.fake_user_prompt,
    )?;

    // Session prior turns. Plain text — both handover and consulting use a
    // single free-text field, persisted as `content_type = 'text'`.
    let session_history = list_session_messages(conn, inputs.session_id)?;
    for msg in &session_history {
        render_session_message_into(msg, &mut contents)?;
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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
                fake_user_prompt: "FAKE_USER",
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

    // --- Phase 7B: Accordion substitution ----------------------------------

    fn segment(
        id: &str,
        start_cp_id: &str,
        end_cp_id: &str,
        summary: Option<&str>,
        is_collapsed: bool,
        use_summary: bool,
    ) -> AccordionSegment {
        AccordionSegment {
            id: id.into(),
            story_id: "story1".into(),
            start_cp_id: start_cp_id.into(),
            end_cp_id: end_cp_id.into(),
            summary: summary.map(str::to_owned),
            is_collapsed,
            use_summary,
            is_stale: false,
            summarised_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            modified_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn cp(id: &str, after_message_id: Option<&str>, is_start: bool) -> Checkpoint {
        Checkpoint {
            id: id.into(),
            story_id: "story1".into(),
            after_message_id: after_message_id.map(str::to_owned),
            name: "C".into(),
            is_start,
            created_at: "2026-01-01T00:00:00Z".into(),
            modified_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn build_history_no_segments_passes_through_literal() {
        let u1_c = UserContent {
            plot_direction: "p1".into(),
            ..Default::default()
        };
        let messages = vec![
            user_row("u1", "2026-01-01T00:00:01Z", &u1_c),
            model_row("m1", "2026-01-01T00:00:02Z", "reply", None),
        ];
        let out = build_history_with_accordion(&messages, &[], &[], "FAKE").unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert!(out[0].parts[0].text.contains("p1"));
        assert_eq!(out[1].parts[0].text, "reply");
    }

    #[test]
    fn build_history_substitutes_collapsed_segment_once() {
        let u1_c = UserContent {
            plot_direction: "p1".into(),
            ..Default::default()
        };
        let u2_c = UserContent {
            plot_direction: "p2".into(),
            ..Default::default()
        };
        // Story has two exchanges (u1/m1 and u2/m2). A closed segment from
        // start-sentinel to cpEnd (anchored at m2) covers all of it and is
        // collapsed with a summary — the whole run becomes a fake-pair.
        let messages = vec![
            user_row("u1", "2026-01-01T00:00:01Z", &u1_c),
            model_row("m1", "2026-01-01T00:00:02Z", "r1", None),
            user_row("u2", "2026-01-01T00:00:03Z", &u2_c),
            model_row("m2", "2026-01-01T00:00:04Z", "r2", None),
        ];
        let cps = vec![cp("cpStart", None, true), cp("cpEnd", Some("m2"), false)];
        let segs = vec![segment(
            "seg1",
            "cpStart",
            "cpEnd",
            Some("CHAPTER ONE SUMMARY"),
            true,
            true,
        )];
        let out = build_history_with_accordion(&messages, &segs, &cps, "FAKE").unwrap();
        assert_eq!(out.len(), 2, "one fake-pair replaces the whole chapter");
        assert_eq!(out[0].role, "user");
        assert_eq!(out[0].parts[0].text, "FAKE");
        assert_eq!(out[1].role, "model");
        assert_eq!(out[1].parts[0].text, "CHAPTER ONE SUMMARY");
    }

    #[test]
    fn build_history_passes_through_segment_without_summary() {
        let u1_c = UserContent {
            plot_direction: "p1".into(),
            ..Default::default()
        };
        let messages = vec![
            user_row("u1", "2026-01-01T00:00:01Z", &u1_c),
            model_row("m1", "2026-01-01T00:00:02Z", "r1", None),
        ];
        let cps = vec![cp("cpStart", None, true), cp("cpEnd", Some("m1"), false)];
        // Segment exists but has no summary — must not substitute.
        let segs = vec![segment("seg1", "cpStart", "cpEnd", None, true, true)];
        let out = build_history_with_accordion(&messages, &segs, &cps, "FAKE").unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].parts[0].text.contains("p1"));
        assert_eq!(out[1].parts[0].text, "r1");
    }

    #[test]
    fn build_history_skips_segment_when_neither_collapsed_nor_use_summary() {
        let u1_c = UserContent {
            plot_direction: "p1".into(),
            ..Default::default()
        };
        let messages = vec![
            user_row("u1", "2026-01-01T00:00:01Z", &u1_c),
            model_row("m1", "2026-01-01T00:00:02Z", "r1", None),
        ];
        let cps = vec![cp("cpStart", None, true), cp("cpEnd", Some("m1"), false)];
        // Has summary but `is_collapsed = false` AND `use_summary = false` —
        // the writer is reading the chapter raw and asked us not to inject.
        let segs = vec![segment(
            "seg1",
            "cpStart",
            "cpEnd",
            Some("ignored"),
            false,
            false,
        )];
        let out = build_history_with_accordion(&messages, &segs, &cps, "FAKE").unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].parts[0].text.contains("p1"));
    }

    #[test]
    fn assemble_story_request_substitutes_using_db_segments() {
        use crate::db::accordion as db_accordion;
        let c = fresh_conn();
        let u1_c = UserContent {
            plot_direction: "early".into(),
            ..Default::default()
        };
        insert_message(&c, &user_row("u1", "2026-01-01T00:00:01Z", &u1_c)).unwrap();
        insert_message(
            &c,
            &model_row("m1", "2026-01-01T00:00:02Z", "early-reply", None),
        )
        .unwrap();

        // Seed start sentinel + tail checkpoint anchored at m1, plus a
        // collapsed segment with summary. assemble_story_request should
        // substitute the whole historic chapter and append only the current
        // turn after the fake-pair.
        db_accordion::insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpStart".into(),
                story_id: "story1".into(),
                after_message_id: None,
                name: "Chapter 1".into(),
                is_start: true,
                created_at: "2026-01-01T00:00:00Z".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .unwrap();
        db_accordion::insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpEnd".into(),
                story_id: "story1".into(),
                after_message_id: Some("m1".into()),
                name: "Chapter 2".into(),
                is_start: false,
                created_at: "2026-01-01T00:00:02Z".into(),
                modified_at: "2026-01-01T00:00:02Z".into(),
            },
        )
        .unwrap();
        db_accordion::insert_segment(
            &c,
            &AccordionSegment {
                id: "seg1".into(),
                story_id: "story1".into(),
                start_cp_id: "cpStart".into(),
                end_cp_id: "cpEnd".into(),
                summary: Some("SUM".into()),
                is_collapsed: true,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: "2026-01-01T00:00:02Z".into(),
                modified_at: "2026-01-01T00:00:02Z".into(),
            },
        )
        .unwrap();

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
                fake_user_prompt: "PLEASE CONTINUE",
            },
        )
        .unwrap();
        // fake-pair (2) + current user turn = 3
        assert_eq!(req.contents.len(), 3);
        assert_eq!(req.contents[0].parts[0].text, "PLEASE CONTINUE");
        assert_eq!(req.contents[1].parts[0].text, "SUM");
        assert!(req.contents[2].parts[0].text.contains("next"));
    }

    #[test]
    fn build_history_passes_open_segment_messages_through() {
        let u1_c = UserContent {
            plot_direction: "p1".into(),
            ..Default::default()
        };
        let u2_c = UserContent {
            plot_direction: "p2".into(),
            ..Default::default()
        };
        // u1/m1 covered by collapsed seg; u2/m2 in the open segment.
        let messages = vec![
            user_row("u1", "2026-01-01T00:00:01Z", &u1_c),
            model_row("m1", "2026-01-01T00:00:02Z", "r1", None),
            user_row("u2", "2026-01-01T00:00:03Z", &u2_c),
            model_row("m2", "2026-01-01T00:00:04Z", "r2", None),
        ];
        let cps = vec![cp("cpStart", None, true), cp("cpMid", Some("m1"), false)];
        let segs = vec![segment(
            "seg1",
            "cpStart",
            "cpMid",
            Some("SEG SUMMARY"),
            true,
            true,
        )];
        let out = build_history_with_accordion(&messages, &segs, &cps, "FAKE").unwrap();
        // fake-pair (2) + u2 + m2 = 4
        assert_eq!(out.len(), 4);
        assert_eq!(out[1].parts[0].text, "SEG SUMMARY");
        assert!(out[2].parts[0].text.contains("p2"));
        assert_eq!(out[3].parts[0].text, "r2");
    }
}
