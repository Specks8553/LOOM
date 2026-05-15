//! Ghostwriter request assembly + history helpers (Doc 17, Phase 8).
//!
//! Two responsibilities live here:
//!   1. Build a mode-aware Gemini request for a surgical-stitching call. The
//!      history prefix is the same shape as a regular `send_message` prefix
//!      (Doc 15 — accordion substitution, feedback, fake-pairs) truncated to
//!      include everything up to and including the AI message being edited.
//!      A synthetic user turn carrying the `<context_*>`/instruction tag block
//!      is appended.
//!   2. Read / mutate `messages.ghostwriter_history` as a JSON array of
//!      [`GhostwriterEdit`] records. Append-on-accept, pop-last-on-revert.
//!
//! Architecture Wall #1: the frontend never assembles history; this module is
//! the only place that touches the Ghostwriter request shape.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::accordion::{self as db_accordion};
use crate::db::conversation_sessions::get_session;
use crate::db::messages::{
    get_message, list_session_messages, list_story_messages, list_story_messages_up_to, ChatMessage,
};
use crate::error::LoomError;
use crate::services::history::{
    build_history_with_accordion, render_message_into, AssembledRequest, GeminiContent,
};

/// Default system instruction baseline. Used when `app_settings.prompt_ghostwriter`
/// resolves to the empty string — matches the v2.0 pattern where Developer-only
/// long prompts seed-default to `""` and the feature's service module owns the
/// fallback text (Doc 03 §settings cascade, Doc 17 §System Instruction).
pub const DEFAULT_GHOSTWRITER_SI: &str = "\
You are a ghostwriter assisting a writer with targeted revisions to story text.

You will receive a revision request containing three tagged sections:

<context_before>: The full text preceding the selection within the same response.
                  Do NOT include this in your output.
<selected_passage>: The text to revise. This is the ONLY part you rewrite.
<context_after>: The full text following the selection within the same response.
                 Do NOT include this in your output.

Rules:
1. Rewrite ONLY the selected passage according to the writer's instruction.
2. Match the tone, voice, and style of the surrounding context.
3. Preserve paragraph structure unless the instruction explicitly asks to change it.
4. Return ONLY the revised passage — no tags, no preamble, no commentary, no surrounding text.";

/// Canonical Ghostwriter edit record per Doc 03 §`GhostwriterEdit` (HB-1).
/// Stored as one element in the `messages.ghostwriter_history` JSON array.
/// Wire-equivalent name in IPC payloads is `GhostwriterEditRecord` (IP-5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct GhostwriterEdit {
    pub edited_at: String,
    pub original_content: String,
    pub new_content: String,
    pub instruction: String,
    pub selected_text: String,
}

/// Inputs for [`build_ghostwriter_request`]. The caller (commands layer)
/// resolves the SI and fake-user prompt from the settings cascade.
pub struct GhostwriterAssembleInputs<'a> {
    pub message_id: &'a str,
    pub selection_start: usize,
    pub selection_end: usize,
    pub instruction: &'a str,
    pub system_instruction: &'a str,
    pub fake_user_prompt: &'a str,
}

/// Output of [`build_ghostwriter_request`]: the request itself plus the
/// pre-validated slice components so the caller can persist them in the
/// future-`save_ghostwriter_edit` flow without re-slicing.
#[derive(Debug)]
pub struct GhostwriterRequest {
    pub request: AssembledRequest,
    /// Original `messages.content` of the edited message (UTF-8 String).
    pub original_content: String,
    /// The selected slice in UTF-8 form. Identical to the `<selected_passage>`
    /// body sent to the model.
    pub selected_text: String,
}

/// Mode-aware request assembly. Returns the full [`AssembledRequest`] (SI,
/// history-with-tag-block-tail) plus the original content + selected text.
///
/// History scope (Doc 17 §History):
/// - `story` kind:  all story-kind messages with `created_at <= edited.created_at`,
///   with accordion / feedback substitution per Doc 16.
/// - `handover` / `consulting` kind: story-up-to-`entry_message_id` (per Doc 23)
///   + the session's messages up to and including the edited one.
pub fn build_ghostwriter_request(
    conn: &Connection,
    inputs: GhostwriterAssembleInputs<'_>,
) -> Result<GhostwriterRequest, LoomError> {
    let instruction = inputs.instruction.trim();
    if instruction.is_empty() {
        return Err(LoomError::validation("Instruction is required."));
    }

    let edited = get_message(conn, inputs.message_id)?
        .ok_or_else(|| LoomError::NotFound(format!("message {} not found", inputs.message_id)))?;
    if edited.role != "model" {
        return Err(LoomError::validation(
            "Ghostwriter only operates on model messages.",
        ));
    }
    if edited.content_type == "blocks" {
        return Err(LoomError::validation(
            "Ghostwriter on mixed text/image messages is coming in v2.1.",
        ));
    }
    if edited.deleted_at.is_some() {
        return Err(LoomError::validation(
            "Ghostwriter cannot target a deleted message.",
        ));
    }

    let (before, selected, after) = slice_selection(
        &edited.content,
        inputs.selection_start,
        inputs.selection_end,
    )?;

    // Build the history prefix — everything up to and including the edited
    // model message. The edited message is included so the model sees its own
    // prior text in the model-role tail; the tag block in the synthetic user
    // turn that follows tells the model *where* in that text to operate.
    let contents = match edited.kind.as_str() {
        "story" => assemble_story_prefix(conn, &edited, inputs.fake_user_prompt)?,
        "handover" | "consulting" => {
            assemble_session_prefix(conn, &edited, inputs.fake_user_prompt)?
        }
        other => {
            return Err(LoomError::Internal(format!(
                "unknown message kind '{other}' on {}",
                edited.id
            )));
        }
    };

    let user_turn = build_user_turn(&before, &selected, &after, instruction);

    let mut contents = contents;
    contents.push(GeminiContent::user(user_turn));

    let system_instruction = if inputs.system_instruction.trim().is_empty() {
        DEFAULT_GHOSTWRITER_SI.to_owned()
    } else {
        inputs.system_instruction.to_owned()
    };

    Ok(GhostwriterRequest {
        request: AssembledRequest {
            system_instruction,
            contents,
            cached_content_name: None,
        },
        original_content: edited.content,
        selected_text: selected,
    })
}

/// Story-kind history: all story messages with `created_at <= edited.created_at`,
/// run through the accordion substitution pass.
fn assemble_story_prefix(
    conn: &Connection,
    edited: &ChatMessage,
    fake_user_prompt: &str,
) -> Result<Vec<GeminiContent>, LoomError> {
    let all = list_story_messages(conn, &edited.story_id)?;
    let truncated: Vec<ChatMessage> = all
        .into_iter()
        .filter(|m| {
            m.created_at.as_str() < edited.created_at.as_str()
                || (m.created_at == edited.created_at && m.id <= edited.id)
        })
        .collect();
    let segments = db_accordion::list_segments(conn, &edited.story_id)?;
    let checkpoints = db_accordion::list_checkpoints(conn, &edited.story_id)?;
    build_history_with_accordion(&truncated, &segments, &checkpoints, fake_user_prompt)
}

/// Session-kind history: story-up-to-`entry_message_id` (with accordion
/// substitution) + this session's messages with `created_at <= edited.created_at`.
fn assemble_session_prefix(
    conn: &Connection,
    edited: &ChatMessage,
    fake_user_prompt: &str,
) -> Result<Vec<GeminiContent>, LoomError> {
    let session_id = edited.session_id.as_deref().ok_or_else(|| {
        LoomError::Internal(format!(
            "session-kind message {} has no session_id",
            edited.id
        ))
    })?;
    let session = get_session(conn, session_id)?
        .ok_or_else(|| LoomError::NotFound(format!("session {session_id} not found")))?;

    let boundary = if let Some(entry_id) = &session.entry_message_id {
        get_message(conn, entry_id)?.map(|m| m.created_at)
    } else {
        None
    };

    let story_history = list_story_messages_up_to(conn, &session.story_id, boundary.as_deref())?;
    let segments = db_accordion::list_segments(conn, &session.story_id)?;
    let checkpoints = db_accordion::list_checkpoints(conn, &session.story_id)?;
    let mut contents =
        build_history_with_accordion(&story_history, &segments, &checkpoints, fake_user_prompt)?;

    let session_history = list_session_messages(conn, session_id)?;
    for msg in &session_history {
        let include = msg.created_at.as_str() < edited.created_at.as_str()
            || (msg.created_at == edited.created_at && msg.id <= edited.id);
        if !include {
            continue;
        }
        // Session bubbles render plain text (Doc 23 — handover/consulting use a
        // single free-text field). Feedback append still applies to model turns.
        render_message_into(msg, &mut contents)?;
    }
    Ok(contents)
}

/// Slice `content` in UTF-16 code units to match the JS `Selection` API.
/// Returns `(before, selected, after)` as UTF-8 strings.
///
/// Surrogate-pair-aware: the frontend passes offsets produced by the standard
/// `Selection` API, which are always code-unit-aligned (the API itself enforces
/// pair integrity). Callers that hand us a non-aligned offset will get a
/// `Validation` error from the `from_utf16` round-trip.
pub fn slice_selection(
    content: &str,
    start: usize,
    end: usize,
) -> Result<(String, String, String), LoomError> {
    let units: Vec<u16> = content.encode_utf16().collect();
    if start > end {
        return Err(LoomError::validation(
            "Selection start must be <= selection end.",
        ));
    }
    if end > units.len() {
        return Err(LoomError::validation(
            "Selection end is past the message content.",
        ));
    }
    if start == end {
        return Err(LoomError::validation("Selection must be non-empty."));
    }
    let before = String::from_utf16(&units[..start])
        .map_err(|e| LoomError::validation(format!("Invalid selection (start): {e}")))?;
    let selected = String::from_utf16(&units[start..end])
        .map_err(|e| LoomError::validation(format!("Invalid selection (passage): {e}")))?;
    let after = String::from_utf16(&units[end..])
        .map_err(|e| LoomError::validation(format!("Invalid selection (after): {e}")))?;
    Ok((before, selected, after))
}

/// Compose the surgical-stitching user-turn body per Doc 17 §Request Assembly.
pub fn build_user_turn(before: &str, selected: &str, after: &str, instruction: &str) -> String {
    format!(
        "<context_before>{before}</context_before>\n\
         <selected_passage>{selected}</selected_passage>\n\
         <context_after>{after}</context_after>\n\
         Instruction: {instruction}"
    )
}

/// Append a [`GhostwriterEdit`] to a `ghostwriter_history` JSON-array string.
/// Returns the new JSON-array string ready for `UPDATE messages …`.
pub fn append_history_entry(
    history_json: &str,
    entry: &GhostwriterEdit,
) -> Result<String, LoomError> {
    let mut entries: Vec<GhostwriterEdit> = parse_history(history_json)?;
    entries.push(entry.clone());
    serde_json::to_string(&entries).map_err(LoomError::from)
}

/// Pop the most-recent entry from a `ghostwriter_history` JSON-array string.
/// Returns `(popped, new_json, remaining_count)`. Errors if the array is empty
/// — callers should check the column shape before invoking revert.
pub fn pop_history_entry(
    history_json: &str,
) -> Result<(GhostwriterEdit, String, usize), LoomError> {
    let mut entries: Vec<GhostwriterEdit> = parse_history(history_json)?;
    let popped = entries
        .pop()
        .ok_or_else(|| LoomError::validation("No Ghostwriter history to revert."))?;
    let new_json = serde_json::to_string(&entries).map_err(LoomError::from)?;
    Ok((popped, new_json, entries.len()))
}

fn parse_history(history_json: &str) -> Result<Vec<GhostwriterEdit>, LoomError> {
    if history_json.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<GhostwriterEdit>>(history_json).map_err(LoomError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{insert_message, ChatMessage};
    use crate::db::migrations::{apply_pending, MigrationRoot};

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

    fn user_row(id: &str, created_at: &str, plot: &str) -> ChatMessage {
        let user = serde_json::json!({
            "plot_direction": plot,
            "background_information": "",
            "modificators": [],
            "constraints": "",
        });
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: user.to_string(),
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

    fn model_row(id: &str, created_at: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "model".into(),
            content_type: "text".into(),
            content: content.into(),
            token_count: None,
            model_name: Some("gemini-2.5-flash".into()),
            finish_reason: Some("STOP".into()),
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    #[test]
    fn slice_selection_basic() {
        let (before, selected, after) = slice_selection("the quick brown fox", 4, 9).unwrap();
        assert_eq!(before, "the ");
        assert_eq!(selected, "quick");
        assert_eq!(after, " brown fox");
    }

    #[test]
    fn slice_selection_validates_bounds() {
        assert!(slice_selection("abc", 2, 1).is_err());
        assert!(slice_selection("abc", 0, 0).is_err());
        assert!(slice_selection("abc", 0, 99).is_err());
    }

    #[test]
    fn slice_selection_utf16_aware() {
        // "héllo" — é is one UTF-16 code unit, so length is 5.
        let s = "héllo";
        let units: Vec<u16> = s.encode_utf16().collect();
        assert_eq!(units.len(), 5);
        let (before, selected, after) = slice_selection(s, 1, 4).unwrap();
        assert_eq!(before, "h");
        assert_eq!(selected, "éll");
        assert_eq!(after, "o");
    }

    #[test]
    fn slice_selection_emoji_surrogate_pair() {
        // "a🎉b" — the party-popper is a surrogate pair (2 UTF-16 code units).
        let s = "a🎉b";
        let units: Vec<u16> = s.encode_utf16().collect();
        assert_eq!(units.len(), 4);
        let (before, selected, after) = slice_selection(s, 1, 3).unwrap();
        assert_eq!(before, "a");
        assert_eq!(selected, "🎉");
        assert_eq!(after, "b");
    }

    #[test]
    fn build_user_turn_shape() {
        let body = build_user_turn("BEFORE", "SEL", "AFTER", "make it bolder");
        assert!(body.contains("<context_before>BEFORE</context_before>"));
        assert!(body.contains("<selected_passage>SEL</selected_passage>"));
        assert!(body.contains("<context_after>AFTER</context_after>"));
        assert!(body.ends_with("Instruction: make it bolder"));
    }

    #[test]
    fn history_append_and_pop_round_trip() {
        let entry1 = GhostwriterEdit {
            edited_at: "2026-05-15T00:00:00Z".into(),
            original_content: "before".into(),
            new_content: "after".into(),
            instruction: "make it bolder".into(),
            selected_text: "bold".into(),
        };
        let entry2 = GhostwriterEdit {
            edited_at: "2026-05-15T00:01:00Z".into(),
            original_content: "after".into(),
            new_content: "after2".into(),
            instruction: "again".into(),
            selected_text: "after".into(),
        };
        let h1 = append_history_entry("[]", &entry1).unwrap();
        let h2 = append_history_entry(&h1, &entry2).unwrap();
        let parsed: Vec<GhostwriterEdit> = serde_json::from_str(&h2).unwrap();
        assert_eq!(parsed.len(), 2);

        let (popped, h3, remaining) = pop_history_entry(&h2).unwrap();
        assert_eq!(popped, entry2);
        assert_eq!(remaining, 1);
        let (popped, _h4, remaining) = pop_history_entry(&h3).unwrap();
        assert_eq!(popped, entry1);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn pop_empty_history_errors() {
        assert!(pop_history_entry("[]").is_err());
        assert!(pop_history_entry("").is_err());
    }

    #[test]
    fn append_handles_empty_string_input() {
        let entry = GhostwriterEdit {
            edited_at: "2026-05-15T00:00:00Z".into(),
            original_content: "before".into(),
            new_content: "after".into(),
            instruction: "x".into(),
            selected_text: "y".into(),
        };
        let json = append_history_entry("", &entry).unwrap();
        let parsed: Vec<GhostwriterEdit> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn build_request_story_includes_history_through_edited() {
        let conn = fresh_conn();
        insert_message(&conn, &user_row("u1", "2026-01-01T00:00:01Z", "open")).unwrap();
        insert_message(
            &conn,
            &model_row("m1", "2026-01-01T00:00:02Z", "Once upon a time."),
        )
        .unwrap();
        insert_message(&conn, &user_row("u2", "2026-01-01T00:00:03Z", "next")).unwrap();
        insert_message(
            &conn,
            &model_row("m2", "2026-01-01T00:00:04Z", "The quick brown fox."),
        )
        .unwrap();
        // m3 must NOT appear — it's after the edited message m2.
        insert_message(&conn, &user_row("u3", "2026-01-01T00:00:05Z", "later")).unwrap();
        insert_message(
            &conn,
            &model_row("m3", "2026-01-01T00:00:06Z", "Tail content."),
        )
        .unwrap();

        let out = build_ghostwriter_request(
            &conn,
            GhostwriterAssembleInputs {
                message_id: "m2",
                selection_start: 4,
                selection_end: 9,
                instruction: "make it sharper",
                system_instruction: "",
                fake_user_prompt: "[ACCORDION FAKE USER]",
            },
        )
        .unwrap();

        assert_eq!(out.original_content, "The quick brown fox.");
        assert_eq!(out.selected_text, "quick");

        // SI fell through to the default baseline.
        assert!(out
            .request
            .system_instruction
            .starts_with("You are a ghostwriter"));

        // Last `contents` entry is our synthetic user turn.
        let last = out.request.contents.last().unwrap();
        assert_eq!(last.role, "user");
        let body = &last.parts[0].text;
        assert!(body.contains("<selected_passage>quick</selected_passage>"));
        assert!(body.ends_with("Instruction: make it sharper"));

        // Second-to-last `contents` entry is the edited model message itself.
        let n = out.request.contents.len();
        let model_tail = &out.request.contents[n - 2];
        assert_eq!(model_tail.role, "model");
        assert_eq!(model_tail.parts[0].text, "The quick brown fox.");

        // Total count: u1, m1, u2, m2, synthetic = 5. m3 / u3 must be absent.
        assert_eq!(n, 5);
    }

    #[test]
    fn build_request_validates_role_and_content_type() {
        let conn = fresh_conn();
        insert_message(&conn, &user_row("u1", "2026-01-01T00:00:01Z", "open")).unwrap();
        // Trying to ghostwrite a user message should fail.
        let err = build_ghostwriter_request(
            &conn,
            GhostwriterAssembleInputs {
                message_id: "u1",
                selection_start: 0,
                selection_end: 1,
                instruction: "x",
                system_instruction: "",
                fake_user_prompt: "",
            },
        )
        .unwrap_err();
        assert!(format!("{err:?}").contains("model messages"));
    }

    #[test]
    fn build_request_rejects_empty_instruction() {
        let conn = fresh_conn();
        insert_message(
            &conn,
            &model_row("m1", "2026-01-01T00:00:01Z", "Hello world."),
        )
        .unwrap();
        let err = build_ghostwriter_request(
            &conn,
            GhostwriterAssembleInputs {
                message_id: "m1",
                selection_start: 0,
                selection_end: 5,
                instruction: "   ",
                system_instruction: "",
                fake_user_prompt: "",
            },
        )
        .unwrap_err();
        assert!(format!("{err:?}").contains("Instruction"));
    }

    #[test]
    fn build_request_honours_caller_si() {
        let conn = fresh_conn();
        insert_message(
            &conn,
            &model_row("m1", "2026-01-01T00:00:01Z", "Hello world."),
        )
        .unwrap();
        let out = build_ghostwriter_request(
            &conn,
            GhostwriterAssembleInputs {
                message_id: "m1",
                selection_start: 0,
                selection_end: 5,
                instruction: "rephrase",
                system_instruction: "CUSTOM SI",
                fake_user_prompt: "",
            },
        )
        .unwrap();
        assert_eq!(out.request.system_instruction, "CUSTOM SI");
    }
}
