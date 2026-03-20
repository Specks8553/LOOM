//! Gemini API client — streaming generation and request assembly.
//!
//! Doc 09 §4–§5: The frontend sends (story_id, leaf_id, user_content).
//! This module builds the Gemini request and streams the response.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::watch;

use crate::error::LoomError;

// ─── Data Types ──────────────────────────────────────────────────────────────

/// Three-field user input per Doc 09 §4.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserContent {
    pub plot_direction: String,
    #[serde(default)]
    pub background_information: String,
    #[serde(default)]
    pub modificators: Vec<String>,
    #[serde(default)]
    pub constraints: String,
    #[serde(default)]
    pub output_length: Option<u32>,
    /// Names of context docs attached at send time (display only, not sent to API).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_doc_names: Vec<String>,
}

/// Message stored in DB and sent to frontend — Doc 09 §1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub story_id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content_type: String,
    pub content: String,
    pub token_count: Option<i64>,
    pub model_name: Option<String>,
    pub finish_reason: Option<String>,
    pub created_at: String,
    pub deleted_at: Option<String>,
    pub user_feedback: Option<String>,
    pub ghostwriter_history: String,
}

/// Emitted per streaming token via Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct StreamChunk {
    pub message_id: String,
    pub delta: String,
}

/// Emitted when streaming completes.
#[derive(Debug, Clone, Serialize)]
pub struct StreamDone {
    pub message_id: String,
    pub user_msg_id: String,
    pub model_msg: ChatMessage,
}

/// Return type for load_story_messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryPayload {
    pub messages: Vec<ChatMessage>,
    pub sibling_counts: Vec<SiblingCount>,
}

/// Fork point with count of siblings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiblingCount {
    pub parent_id: String,
    pub count: i64,
}

// ─── Request Assembly ────────────────────────────────────────────────────────

/// Build the user turn text sent to Gemini from UserContent — Doc 09 §4.2.
pub fn build_user_turn_text(content: &UserContent) -> String {
    let mut parts = vec![];
    parts.push(format!(
        "[PLOT DIRECTION]\n{}",
        content.plot_direction.trim()
    ));
    if !content.background_information.trim().is_empty() {
        parts.push(format!(
            "[BACKGROUND INFORMATION — NOT FOR THE READER]\n{}",
            content.background_information.trim()
        ));
    }
    if !content.modificators.is_empty() {
        let joined: Vec<&str> = content
            .modificators
            .iter()
            .filter(|m| !m.trim().is_empty())
            .map(|m| m.as_str())
            .collect();
        if !joined.is_empty() {
            parts.push(format!("[MODIFICATORS]\n{}", joined.join(" · ")));
        }
    }
    if !content.constraints.trim().is_empty() {
        parts.push(format!(
            "[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\n{}",
            content.constraints.trim()
        ));
    }
    parts.join("\n\n")
}

/// Build feedback-injected model content — Doc 09 §4.3.
pub fn build_history_message_with_feedback(content: &str, feedback: Option<&str>) -> String {
    let mut result = content.to_string();
    if let Some(fb) = feedback {
        if !fb.trim().is_empty() {
            result.push_str(&format!("\n\n[WRITER FEEDBACK]\n{}", fb.trim()));
        }
    }
    result
}

/// A context doc to inject inline in the current user turn.
pub struct ContextDocContent {
    pub name: String,
    pub content: String,
}

/// Assemble the complete Gemini API request body.
/// `output_length` is appended to system_instructions when Some and >= 200.
/// `context_docs` are injected as additional text parts in the current user turn
/// (NOT in history) — Doc 12 §7.
pub fn build_gemini_request(
    system_instructions: &str,
    history: &[ChatMessage],
    user_turn: &str,
    output_length: Option<u32>,
    context_docs: &[ContextDocContent],
) -> serde_json::Value {
    let mut contents = Vec::new();

    // History messages (alternating user/model)
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "model" };
        let text = if msg.role == "user" {
            // Parse stored JSON to reconstruct the turn text
            if msg.content_type == "json_user" {
                match serde_json::from_str::<UserContent>(&msg.content) {
                    Ok(uc) => build_user_turn_text(&uc),
                    Err(_) => msg.content.clone(),
                }
            } else {
                msg.content.clone()
            }
        } else {
            // Model message: inject feedback if present
            build_history_message_with_feedback(&msg.content, msg.user_feedback.as_deref())
        };

        contents.push(serde_json::json!({
            "role": role,
            "parts": [{ "text": text }]
        }));
    }

    // Current user turn: user input + context docs as additional parts
    let mut user_parts = vec![serde_json::json!({ "text": user_turn })];

    // Inject context docs inline in the current turn (not in history)
    for doc in context_docs {
        user_parts.push(serde_json::json!({
            "text": format!("[CONTEXT DOC: {}]\n{}", doc.name, doc.content)
        }));
    }

    contents.push(serde_json::json!({
        "role": "user",
        "parts": user_parts
    }));

    let mut body = serde_json::json!({ "contents": contents });

    // System instruction — with optional output length amendment
    let mut sys = system_instructions.trim().to_string();
    if let Some(len) = output_length {
        if len >= 200 {
            if !sys.is_empty() {
                sys.push_str("\n\n");
            }
            sys.push_str(&format!(
                "[OUTPUT LENGTH] write approximately {} words for your next output regardless of the length of other messages",
                len
            ));
        }
    }

    if !sys.is_empty() {
        body["system_instruction"] = serde_json::json!({
            "parts": [{ "text": sys }]
        });
    }

    body
}

// ─── Streaming ───────────────────────────────────────────────────────────────

/// Result from streaming: accumulated content + metadata.
pub struct StreamResult {
    pub content: String,
    pub token_count: Option<i64>,
    pub finish_reason: Option<String>,
}

/// Stream a Gemini generateContent request, emitting chunks via Tauri events.
///
/// Returns the accumulated result. Respects the cancel_rx signal.
pub async fn stream_generate(
    api_key: &str,
    model_name: &str,
    request_body: &serde_json::Value,
    app: &tauri::AppHandle,
    temp_model_id: &str,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<StreamResult, LoomError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model_name, api_key
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(request_body)
        .send()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to connect to Gemini: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(LoomError::ApiRequest(format!(
            "Gemini API returned {}: {}",
            status, body
        )));
    }

    let mut accumulated = String::new();
    let mut token_count: Option<i64> = None;
    let mut finish_reason: Option<String> = None;
    let mut cancelled = false;

    // Read SSE stream line by line
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut line_buf = String::new();

    loop {
        let chunk_opt = tokio::select! {
            biased;
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    cancelled = true;
                    None
                } else {
                    continue;
                }
            }
            chunk = stream.next() => chunk,
        };

        let chunk_result = match chunk_opt {
            Some(r) => r,
            None => break, // stream ended or cancelled
        };

        let bytes = chunk_result
            .map_err(|e| LoomError::ApiRequest(format!("Stream read error: {}", e)))?;

        let text = String::from_utf8_lossy(&bytes);
        line_buf.push_str(&text);

        // Process complete SSE lines
        while let Some(newline_pos) = line_buf.find('\n') {
            let line = line_buf[..newline_pos].trim_end_matches('\r').to_string();
            line_buf = line_buf[newline_pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    // Extract text delta
                    if let Some(delta_text) = json
                        .pointer("/candidates/0/content/parts/0/text")
                        .and_then(|v| v.as_str())
                    {
                        accumulated.push_str(delta_text);
                        let _ = app.emit(
                            "stream_chunk",
                            StreamChunk {
                                message_id: temp_model_id.to_string(),
                                delta: delta_text.to_string(),
                            },
                        );
                    }

                    // Extract finish reason
                    if let Some(fr) = json
                        .pointer("/candidates/0/finishReason")
                        .and_then(|v| v.as_str())
                    {
                        finish_reason = Some(fr.to_string());
                    }

                    // Extract token count from usageMetadata
                    if let Some(tc) = json
                        .pointer("/usageMetadata/totalTokenCount")
                        .and_then(|v| v.as_i64())
                    {
                        token_count = Some(tc);
                    }
                }
            }
        }
    }

    if cancelled {
        return Err(LoomError::GenerationCancelled);
    }

    Ok(StreamResult {
        content: accumulated,
        token_count,
        finish_reason,
    })
}

// ─── Ghostwriter (non-streamed) — Doc 16 §3 ─────────────────────────────────

/// Build a Ghostwriter request payload.
/// Uses a custom system prompt with selected_text, instruction, and original_content.
pub fn build_ghostwriter_request(
    system_prompt: &str,
    history: &[ChatMessage],
    selected_text: &str,
    instruction: &str,
    context_before: &str,
    context_after: &str,
) -> serde_json::Value {
    let mut contents = Vec::new();

    // History messages — includes the full conversation up to and including
    // the AI message being edited (provides narrative arc + style context)
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "model" };
        let text = if msg.role == "user" {
            if msg.content_type == "json_user" {
                match serde_json::from_str::<UserContent>(&msg.content) {
                    Ok(uc) => build_user_turn_text(&uc),
                    Err(_) => msg.content.clone(),
                }
            } else {
                msg.content.clone()
            }
        } else {
            build_history_message_with_feedback(&msg.content, msg.user_feedback.as_deref())
        };

        contents.push(serde_json::json!({
            "role": role,
            "parts": [{ "text": text }]
        }));
    }

    // User turn with the tagged editing request.
    // The AI returns ONLY the rewritten selected passage — the frontend stitches it back.
    let user_turn = format!(
        "<context_before>\n{}\n</context_before>\n\n<selected_passage>\n{}\n</selected_passage>\n\n<context_after>\n{}\n</context_after>\n\nInstruction: {}",
        context_before, selected_text, context_after, instruction
    );
    contents.push(serde_json::json!({
        "role": "user",
        "parts": [{ "text": user_turn }]
    }));

    let mut body = serde_json::json!({ "contents": contents });

    if !system_prompt.is_empty() {
        body["system_instruction"] = serde_json::json!({
            "parts": [{ "text": system_prompt }]
        });
    }

    body
}

/// Non-streaming Gemini generate call for Ghostwriter.
/// Returns the complete response text and token count.
pub async fn generate_non_streaming(
    api_key: &str,
    model_name: &str,
    request_body: &serde_json::Value,
) -> Result<(String, Option<i64>), LoomError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model_name, api_key
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(request_body)
        .send()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to connect to Gemini: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(LoomError::ApiRequest(format!(
            "Gemini API returned {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to parse Gemini response: {}", e)))?;

    let content = json
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let token_count = json
        .pointer("/usageMetadata/totalTokenCount")
        .and_then(|v| v.as_i64());

    Ok((content, token_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_user_turn_text_full() {
        let uc = UserContent {
            plot_direction: "She opens the letter.".to_string(),
            background_information: "The letter is from her dead mother.".to_string(),
            modificators: vec!["dark".to_string(), "slow burn".to_string()],
            constraints: String::new(),
            output_length: None,
            context_doc_names: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert!(result.contains("[PLOT DIRECTION]\nShe opens the letter."));
        assert!(result.contains("[BACKGROUND INFORMATION — NOT FOR THE READER]"));
        assert!(result.contains("[MODIFICATORS]\ndark · slow burn"));
        // output_length should NOT appear in user turn text
        assert!(!result.contains("[OUTPUT LENGTH]"));
    }

    #[test]
    fn test_build_user_turn_text_minimal() {
        let uc = UserContent {
            plot_direction: "Continue the story.".to_string(),
            background_information: String::new(),
            modificators: vec![],
            constraints: String::new(),
            output_length: None,
            context_doc_names: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert_eq!(result, "[PLOT DIRECTION]\nContinue the story.");
    }

    #[test]
    fn test_build_user_turn_text_with_constraints() {
        let uc = UserContent {
            plot_direction: "Continue.".to_string(),
            background_information: String::new(),
            modificators: vec![],
            constraints: "No dialogue.".to_string(),
            output_length: Some(500),
            context_doc_names: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert!(result.contains("[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\nNo dialogue."));
        // output_length must NOT be in user turn — it goes in system instructions
        assert!(!result.contains("[OUTPUT LENGTH]"));
        assert!(!result.contains("500"));
    }

    #[test]
    fn test_feedback_injection() {
        let result =
            build_history_message_with_feedback("The sun set slowly.", Some("Too rushed."));
        assert!(result.contains("[WRITER FEEDBACK]\nToo rushed."));
    }

    #[test]
    fn test_feedback_injection_empty() {
        let result = build_history_message_with_feedback("Content here.", Some("  "));
        assert!(!result.contains("[WRITER FEEDBACK]"));
    }
}
