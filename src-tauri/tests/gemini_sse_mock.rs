//! Gemini SSE mock recipe (Doc 25 §Gemini SSE mock recipe).
//!
//! Demonstrates the canonical HTTP-boundary mock pattern used by
//! `services/gemini.rs` integration tests. The real streaming consumer
//! parses each `data:` line as it arrives via `reqwest`'s async byte stream;
//! this fixture generates that stream from canned strings.

use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Build a raw SSE body for the given text chunks.
///
/// Each chunk is formatted as a Gemini streaming response `data:` line.
/// The caller controls the number of chunks; the receiver must parse each line.
fn sse_body(chunks: &[&str]) -> String {
    let mut body = String::new();
    for text in chunks {
        let json = format!(
            r#"{{"candidates":[{{"content":{{"parts":[{{"text":"{text}"}}],"role":"model"}},"finishReason":"STOP","index":0}}]}}"#
        );
        body.push_str("data: ");
        body.push_str(&json);
        body.push_str("\r\n\r\n");
    }
    body
}

#[tokio::test]
async fn gemini_sse_streams_three_chunks() {
    let server = MockServer::start().await;

    // Match any POST — the real client will add the full Gemini path; the mock
    // just needs to intercept any POST to exercise the SSE parsing recipe.
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(sse_body(&["Hello", ", ", "world"]), "text/event-stream"),
        )
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/generate", server.uri()))
        .send()
        .await
        .expect("request to mock server failed");

    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();

    assert!(
        body.contains(r#""text":"Hello""#),
        "chunk 1 missing from body"
    );
    assert!(body.contains(r#""text":", ""#), "chunk 2 missing from body");
    assert!(
        body.contains(r#""text":"world""#),
        "chunk 3 missing from body"
    );
}

#[test]
fn sse_body_helper_formats_correctly() {
    let body = sse_body(&["ping"]);
    assert!(body.starts_with("data: "), "must start with 'data: '");
    assert!(body.contains(r#""text":"ping""#));
    assert!(body.ends_with("\r\n\r\n"), "must end with SSE double CRLF");
}
