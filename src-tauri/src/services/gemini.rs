//! Gemini API client (Doc 05 §services/gemini.rs, Doc 15 §Gemini Streaming).
//!
//! Owns the HTTP boundary: request body construction, `streamGenerateContent`
//! SSE consumption with `tokio_util::CancellationToken` cooperation, and
//! `countTokens` for the input-area pre-flight meter.
//!
//! Per Doc 05's dependency rules, this module makes HTTP calls and parses
//! responses — it does **not** write to the DB. Persistence is the caller's
//! responsibility (`commands/conversation.rs`).

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use ts_rs::TS;

use crate::error::LoomError;
use crate::services::history::{AssembledRequest, GeminiContent};

/// Tunable generation parameters as resolved from the settings cascade for
/// a single send. Names mirror the Gemini API field names (camelCase on the
/// wire; snake_case here per Rust convention).
#[derive(Debug, Clone)]
pub struct GenerationParams {
    pub temperature: f64,
    pub top_p: f64,
    pub top_k: u32,
    pub max_output_tokens: u32,
}

/// Outcome of a streaming run, returned to the caller after the stream
/// terminates (whether by `STOP`, MAX_TOKENS, network drop, or cancellation).
#[derive(Debug, Clone, Default)]
pub struct StreamOutcome {
    /// Concatenated text from every chunk seen.
    pub full_text: String,
    /// Final finish_reason from Gemini, if any chunk reported one.
    pub finish_reason: Option<String>,
    /// Token count from the final usageMetadata, if present.
    pub token_count: Option<i64>,
    /// True if the stream was cancelled mid-flight via the cancellation
    /// token. The caller distinguishes this from a clean `STOP` to decide
    /// whether to emit `generation_cancelled` vs `message_complete`.
    pub cancelled: bool,
}

/// Default base URL for the Gemini REST API. Override in tests by passing
/// the `base_url` directly to `stream_generate_with_url` / `count_tokens_with_url`.
pub const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Build the JSON body Gemini's `streamGenerateContent` and `countTokens`
/// endpoints accept. The same shape works for both — the URL determines the
/// behaviour. The `system_instruction` field is omitted when empty so the
/// model uses its default.
pub fn build_request_body(req: &AssembledRequest, params: &GenerationParams) -> Value {
    let mut body = json!({
        "contents": req.contents,
        "generationConfig": {
            "temperature": params.temperature,
            "topP": params.top_p,
            "topK": params.top_k,
            "maxOutputTokens": params.max_output_tokens,
        }
    });
    if !req.system_instruction.trim().is_empty() {
        body["systemInstruction"] = json!({
            "parts": [{ "text": req.system_instruction }]
        });
    }
    body
}

/// Build the body for `countTokens`. Doc 15 says "the same request that
/// send_message would" — so this re-uses the assembled history, but Gemini's
/// countTokens endpoint takes only `contents` (no generation config, no
/// system_instruction at the top level — they're folded in differently).
pub fn build_count_tokens_body(req: &AssembledRequest) -> Value {
    let mut contents: Vec<GeminiContent> = req.contents.clone();
    if !req.system_instruction.trim().is_empty() {
        // For countTokens, count the system instruction by prepending it as
        // an additional user content. Gemini's official countTokens API does
        // not have a dedicated system_instruction slot; this approximation
        // is conservative (token count is an upper bound).
        contents.insert(
            0,
            GeminiContent {
                role: "user".into(),
                parts: vec![crate::services::history::GeminiPart {
                    text: req.system_instruction.clone(),
                }],
            },
        );
    }
    json!({ "contents": contents })
}

#[derive(Debug, Deserialize)]
struct CountTokensResponse {
    #[serde(rename = "totalTokens")]
    total_tokens: i64,
}

/// Result of a `countTokens` call. Phase 3 returns just the total — the
/// IPC-facing `TokenEstimate { history, doc, user_turn, total }` shape from
/// Doc 15 is built in the command layer once doc-attachment lands (Phase 5).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct TokenEstimate {
    pub history_tokens: i64,
    pub doc_tokens: i64,
    pub user_turn_tokens: i64,
    pub total: i64,
}

/// Call Gemini's `:countTokens` endpoint and return the total. Phase 5 will
/// split the total into history / doc / user-turn buckets via separate
/// requests; Phase 3 just exposes `total` (the others are zero).
pub async fn count_tokens(
    api_key: &str,
    model: &str,
    req: &AssembledRequest,
) -> Result<TokenEstimate, LoomError> {
    count_tokens_with_url(GEMINI_BASE_URL, api_key, model, req).await
}

pub async fn count_tokens_with_url(
    base_url: &str,
    api_key: &str,
    model: &str,
    req: &AssembledRequest,
) -> Result<TokenEstimate, LoomError> {
    let url = format!("{base_url}/models/{model}:countTokens?key={api_key}");
    let body = build_count_tokens_body(req);
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::ApiError(format!("client build: {e}")))?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| LoomError::ApiError(format!("countTokens send: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::ApiError(format!(
            "countTokens HTTP {status}: {text}"
        )));
    }
    let parsed: CountTokensResponse = resp
        .json()
        .await
        .map_err(|e| LoomError::ApiError(format!("countTokens parse: {e}")))?;
    Ok(TokenEstimate {
        history_tokens: 0,
        doc_tokens: 0,
        user_turn_tokens: 0,
        total: parsed.total_tokens,
    })
}

/// Hook that receives each text chunk as it arrives. Returns `Err` to abort
/// the stream early (treated as a cancellation by the caller).
pub trait ChunkSink: Send {
    fn on_chunk(&mut self, chunk: &str) -> Result<(), LoomError>;
}

/// Issue `streamGenerateContent` against Gemini and forward chunks to `sink`.
///
/// Uses `?alt=sse` so the response is a Server-Sent-Events stream of `data:`
/// lines. Each `data:` payload is a JSON object with the same shape as a
/// non-streaming response — we extract `candidates[0].content.parts[0].text`
/// and the optional `finishReason` / `usageMetadata.totalTokenCount`.
///
/// Cooperates with `cancel_token`: each iteration of the read loop checks
/// the token, and an explicit `tokio::select!` aborts the underlying
/// connection when cancelled. (Doc 24 §Async/Cancellation: "reqwest stream
/// drop does not cancel the HTTP connection — abort explicitly.")
pub async fn stream_generate(
    api_key: &str,
    model: &str,
    req: &AssembledRequest,
    params: &GenerationParams,
    sink: &mut dyn ChunkSink,
    cancel_token: CancellationToken,
) -> Result<StreamOutcome, LoomError> {
    stream_generate_with_url(
        GEMINI_BASE_URL,
        api_key,
        model,
        req,
        params,
        sink,
        cancel_token,
    )
    .await
}

pub async fn stream_generate_with_url(
    base_url: &str,
    api_key: &str,
    model: &str,
    req: &AssembledRequest,
    params: &GenerationParams,
    sink: &mut dyn ChunkSink,
    cancel_token: CancellationToken,
) -> Result<StreamOutcome, LoomError> {
    let url = format!("{base_url}/models/{model}:streamGenerateContent?alt=sse&key={api_key}");
    let body = build_request_body(req, params);

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::ApiError(format!("client build: {e}")))?;

    debug!(model = %model, "stream_generate: opening SSE");

    let send_fut = client.post(&url).json(&body).send();
    let resp = tokio::select! {
        biased;
        _ = cancel_token.cancelled() => {
            return Ok(StreamOutcome { cancelled: true, ..Default::default() });
        }
        r = send_fut => r.map_err(|e| LoomError::ApiError(format!("stream send: {e}")))?,
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::ApiError(format!(
            "streamGenerateContent HTTP {status}: {text}"
        )));
    }

    let mut outcome = StreamOutcome::default();
    let mut buf = Vec::<u8>::new();
    let mut stream = resp.bytes_stream();

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                outcome.cancelled = true;
                break;
            }
            next = stream.next() => {
                match next {
                    None => break,
                    Some(Err(e)) => {
                        return Err(LoomError::ApiError(format!("stream read: {e}")));
                    }
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        drain_sse_events(&mut buf, sink, &mut outcome)?;
                    }
                }
            }
        }
    }

    Ok(outcome)
}

/// Pull every complete SSE event (`data: ...\n\n`) out of `buf`, leaving any
/// partial trailing event in place for the next chunk. Each event payload is
/// expected to be JSON — we ignore non-JSON payloads (Gemini occasionally
/// sends keep-alive comments).
fn drain_sse_events(
    buf: &mut Vec<u8>,
    sink: &mut dyn ChunkSink,
    outcome: &mut StreamOutcome,
) -> Result<(), LoomError> {
    loop {
        let Some(end) = find_double_newline(buf) else {
            return Ok(());
        };
        let raw = buf.drain(..end).collect::<Vec<u8>>();
        // Consume the trailing `\n\n` (or `\r\n\r\n`).
        let to_skip = double_newline_len(buf);
        if to_skip > 0 && buf.len() >= to_skip {
            buf.drain(..to_skip);
        }
        let event = String::from_utf8_lossy(&raw).to_string();
        for line in event.lines() {
            let Some(payload) = line.strip_prefix("data:") else {
                continue;
            };
            let payload = payload.trim_start();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            match serde_json::from_str::<Value>(payload) {
                Ok(value) => extract_chunk(&value, sink, outcome)?,
                Err(e) => {
                    warn!("gemini SSE parse failure: {e}");
                }
            }
        }
    }
}

fn find_double_newline(buf: &[u8]) -> Option<usize> {
    // Match either "\n\n" or "\r\n\r\n", returning the index of the first
    // byte of the terminator.
    for i in 0..buf.len() {
        if buf[i..].starts_with(b"\r\n\r\n") || buf[i..].starts_with(b"\n\n") {
            return Some(i);
        }
    }
    None
}

fn double_newline_len(buf: &[u8]) -> usize {
    if buf.starts_with(b"\r\n\r\n") {
        4
    } else if buf.starts_with(b"\n\n") {
        2
    } else {
        0
    }
}

fn extract_chunk(
    value: &Value,
    sink: &mut dyn ChunkSink,
    outcome: &mut StreamOutcome,
) -> Result<(), LoomError> {
    if let Some(candidates) = value.get("candidates").and_then(Value::as_array) {
        for cand in candidates {
            if let Some(parts) = cand
                .get("content")
                .and_then(|c| c.get("parts"))
                .and_then(Value::as_array)
            {
                for part in parts {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            outcome.full_text.push_str(text);
                            sink.on_chunk(text)?;
                        }
                    }
                }
            }
            if let Some(reason) = cand.get("finishReason").and_then(Value::as_str) {
                outcome.finish_reason = Some(reason.to_owned());
            }
        }
    }
    if let Some(meta) = value.get("usageMetadata") {
        if let Some(total) = meta.get("totalTokenCount").and_then(Value::as_i64) {
            outcome.token_count = Some(total);
        }
    }
    Ok(())
}

/// Helper that captures every chunk into a buffer — used by tests and
/// kept here so other services can re-use it if they want a string back.
#[derive(Default)]
pub struct StringChunkSink {
    pub buffer: String,
}

impl ChunkSink for StringChunkSink {
    fn on_chunk(&mut self, chunk: &str) -> Result<(), LoomError> {
        self.buffer.push_str(chunk);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::history::{AssembledRequest, GeminiContent, GeminiPart};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample_request() -> AssembledRequest {
        AssembledRequest {
            system_instruction: "be helpful".into(),
            contents: vec![GeminiContent {
                role: "user".into(),
                parts: vec![GeminiPart {
                    text: "[PLOT DIRECTION]\nopen with rain".into(),
                }],
            }],
        }
    }

    fn sample_params() -> GenerationParams {
        GenerationParams {
            temperature: 1.0,
            top_p: 0.95,
            top_k: 40,
            max_output_tokens: 8192,
        }
    }

    #[test]
    fn build_request_body_includes_system_instruction_when_present() {
        let body = build_request_body(&sample_request(), &sample_params());
        assert!(body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("be helpful"));
        assert_eq!(
            body["generationConfig"]["temperature"].as_f64().unwrap(),
            1.0
        );
    }

    #[test]
    fn build_request_body_omits_empty_system_instruction() {
        let mut req = sample_request();
        req.system_instruction = String::new();
        let body = build_request_body(&req, &sample_params());
        assert!(body.get("systemInstruction").is_none());
    }

    #[test]
    fn drain_handles_split_chunks() {
        let mut buf = Vec::new();
        let mut sink = StringChunkSink::default();
        let mut outcome = StreamOutcome::default();
        // First half of an event arrives.
        buf.extend_from_slice(b"data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hel");
        drain_sse_events(&mut buf, &mut sink, &mut outcome).unwrap();
        assert!(sink.buffer.is_empty());
        // Rest of the event + terminator.
        buf.extend_from_slice(b"lo\"}]}}]}\n\n");
        drain_sse_events(&mut buf, &mut sink, &mut outcome).unwrap();
        assert_eq!(sink.buffer, "hello");
    }

    #[test]
    fn drain_records_finish_reason_and_token_count() {
        let mut buf = Vec::new();
        let mut sink = StringChunkSink::default();
        let mut outcome = StreamOutcome::default();
        let payload = b"data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"totalTokenCount\":42}}\n\n";
        buf.extend_from_slice(payload);
        drain_sse_events(&mut buf, &mut sink, &mut outcome).unwrap();
        assert_eq!(outcome.finish_reason.as_deref(), Some("STOP"));
        assert_eq!(outcome.token_count, Some(42));
    }

    #[tokio::test]
    async fn stream_generate_forwards_chunks_and_records_outcome() {
        let server = MockServer::start().await;
        // Two SSE events — the second carries finishReason.
        let body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hel\"}]}}]}\n\n\
                    data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo\"}]}},{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"totalTokenCount\":7}}\n\n";
        Mock::given(method("POST"))
            .and(path("/models/gemini-2.5-flash:streamGenerateContent"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(body)
                    .insert_header("content-type", "text/event-stream"),
            )
            .mount(&server)
            .await;

        let mut sink = StringChunkSink::default();
        let token = CancellationToken::new();
        let outcome = stream_generate_with_url(
            &server.uri(),
            "test-key",
            "gemini-2.5-flash",
            &sample_request(),
            &sample_params(),
            &mut sink,
            token,
        )
        .await
        .unwrap();
        assert_eq!(sink.buffer, "hello");
        assert_eq!(outcome.full_text, "hello");
        assert_eq!(outcome.finish_reason.as_deref(), Some("STOP"));
        assert_eq!(outcome.token_count, Some(7));
        assert!(!outcome.cancelled);
    }

    #[tokio::test]
    async fn stream_generate_aborts_when_cancelled_before_send() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("data: {}\n\n"))
            .mount(&server)
            .await;
        let token = CancellationToken::new();
        token.cancel();
        let mut sink = StringChunkSink::default();
        let outcome = stream_generate_with_url(
            &server.uri(),
            "test-key",
            "gemini-2.5-flash",
            &sample_request(),
            &sample_params(),
            &mut sink,
            token,
        )
        .await
        .unwrap();
        assert!(outcome.cancelled);
        assert_eq!(outcome.full_text, "");
    }

    #[tokio::test]
    async fn count_tokens_reports_total() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/models/gemini-2.5-flash:countTokens"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "totalTokens": 1234
            })))
            .mount(&server)
            .await;
        let est = count_tokens_with_url(
            &server.uri(),
            "test-key",
            "gemini-2.5-flash",
            &sample_request(),
        )
        .await
        .unwrap();
        assert_eq!(est.total, 1234);
    }

    #[tokio::test]
    async fn stream_generate_surfaces_http_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429).set_body_string("rate limited"))
            .mount(&server)
            .await;
        let mut sink = StringChunkSink::default();
        let token = CancellationToken::new();
        let err = stream_generate_with_url(
            &server.uri(),
            "test-key",
            "gemini-2.5-flash",
            &sample_request(),
            &sample_params(),
            &mut sink,
            token,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, LoomError::ApiError(_)));
    }
}
