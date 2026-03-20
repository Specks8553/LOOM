# 06 — Telemetry and Rate Limiting

## Purpose

This document specifies LOOM's internal usage tracking (telemetry) and rate
limit enforcement system. Because the Gemini API exposes no programmatic
quota-query endpoint and returns no rate-limit headers, LOOM maintains its own
counters. The architecture is designed to be multi-provider from v1 — text
telemetry is fully implemented; image generation and TTS slots are stubbed.

> **Coding-agent note:** All counter logic lives in `src-tauri/src/rate_limiter.rs`.
> The `RateLimiter` struct is held in `AppState` and accessed by every
> `send_message` and `send_ghostwriter_request` command. Counter state is
> persisted to the `telemetry` table in the active world's SQLCipher DB on
> every update. Limits are read from `settings` on each `check_rate_limit()`
> call — no restart required after changing them.

---

## 1. Research Finding: Gemini API Quota Visibility

The Gemini API does **not** expose rate limit state programmatically:

- No `x-ratelimit-remaining-*` headers in responses.
- No REST endpoint to query current usage.
- 429 responses contain only `{ "error": { "code": 429, "status": "RESOURCE_EXHAUSTED" } }` —
  no `Retry-After`, no remaining-quota field.
- Quota is only visible in Google AI Studio web dashboard.
- RPD resets at **midnight Pacific Time (PT)**, not UTC.

LOOM's internal counter approach is therefore the only viable client-side
architecture for rate awareness.

---

## 2. Counter Architecture

### 2.1 Provider Slots

```rust
// src-tauri/src/rate_limiter.rs

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderCounters {
    pub provider:              String,  // "text" | "image_gen" | "tts"
    pub requests_this_minute:  u32,
    pub tokens_this_minute:    u32,
    pub requests_today:        u32,
    pub minute_window_start:   i64,    // Unix timestamp (seconds)
    pub day_window_start:      i64,    // Unix timestamp (seconds) — midnight PT
}

pub struct RateLimiter {
    pub text:       ProviderCounters,
    pub image_gen:  ProviderCounters,  // stub — zeroed, never incremented in v1
    pub tts:        ProviderCounters,  // stub — zeroed, never incremented in v1
}
```

### 2.2 Window Logic

**RPM window (rolling 60 seconds):**
On each `check_rate_limit()` call: if `now - minute_window_start >= 60`,
reset `requests_this_minute = 0`, `tokens_this_minute = 0`,
`minute_window_start = now`.

**RPD window (midnight PT):**
On each call: compute today's midnight PT as Unix timestamp.
If `day_window_start < today_midnight_pt`, reset `requests_today = 0`,
`day_window_start = today_midnight_pt`.

**Midnight PT computation:**

```rust
fn today_midnight_pt_unix() -> i64 {
    use chrono_tz::America::Los_Angeles;
    use chrono::{TimeZone, Utc, Datelike};
    let now_pt = Utc::now().with_timezone(&Los_Angeles);
    let midnight = Los_Angeles
        .with_ymd_and_hms(now_pt.year(), now_pt.month(), now_pt.day(), 0, 0, 0)
        .unwrap();
    midnight.timestamp()
}
```

`Cargo.toml` additions:
```toml
chrono     = { version = "0.4", features = ["serde"] }
chrono-tz  = "0.9"
```

---

## 3. `check_rate_limit()` and `record_usage()`

### 3.1 Check (called before every send — text AND Ghostwriter)

```rust
pub struct RateLimitStatus {
    pub can_proceed: bool,
    pub reason:   Option<String>,  // "RPM" | "TPM" | "RPD" | null
    pub wait_ms:  Option<u64>,
}

pub fn check_rate_limit(
    &mut self,
    provider: &str,
    settings: &HashMap<String, String>,
) -> RateLimitStatus {
    self.tick_windows(provider);

    let counters = self.get_counters_mut(provider);
    let rpm = parse_setting(settings, "rate_limit_rpm", 10u32);
    let tpm = parse_setting(settings, "rate_limit_tpm", 250_000u32);
    let rpd = parse_setting(settings, "rate_limit_rpd", 1500u32);

    if counters.requests_this_minute >= rpm {
        let wait = 60_000u64.saturating_sub(
            (now_unix() - counters.minute_window_start) as u64 * 1000
        );
        return RateLimitStatus { can_proceed: false,
            reason: Some("RPM".into()), wait_ms: Some(wait) };
    }
    if counters.tokens_this_minute >= tpm {
        let wait = 60_000u64.saturating_sub(
            (now_unix() - counters.minute_window_start) as u64 * 1000
        );
        return RateLimitStatus { can_proceed: false,
            reason: Some("TPM".into()), wait_ms: Some(wait) };
    }
    if counters.requests_today >= rpd {
        let wait_secs = (today_midnight_pt_unix() + 86_400)
            .saturating_sub(now_unix()) as u64;
        return RateLimitStatus { can_proceed: false,
            reason: Some("RPD".into()), wait_ms: Some(wait_secs * 1000) };
    }

    RateLimitStatus { can_proceed: true, reason: None, wait_ms: None }
}
```

### 3.2 Record (called after every response — text AND Ghostwriter)

```rust
pub fn record_usage(&mut self, provider: &str, tokens_used: u32) {
    let counters = self.get_counters_mut(provider);
    counters.requests_this_minute += 1;
    counters.tokens_this_minute   += tokens_used;
    counters.requests_today       += 1;
    // Persist to DB (see §4)
}
```

Called **after** the API response is received and token count is known from
`usageMetadata.totalTokenCount` in the Gemini response.

### 3.3 Rate Limiting Applies to All AI Requests

Both `send_message` (normal story generation) and `send_ghostwriter_request`
(Ghostwriter) must:
1. Call `check_rate_limit("text")` before the request
2. Call `record_usage("text", token_count)` after the response

Failure to rate-limit Ghostwriter requests is a bug.

---

## 4. Persistence

### 4.1 `telemetry` Table

```sql
CREATE TABLE IF NOT EXISTS telemetry (
    provider               TEXT PRIMARY KEY,
    requests_this_minute   INTEGER NOT NULL DEFAULT 0,
    tokens_this_minute     INTEGER NOT NULL DEFAULT 0,
    requests_today         INTEGER NOT NULL DEFAULT 0,
    minute_window_start    INTEGER NOT NULL DEFAULT 0,
    day_window_start       INTEGER NOT NULL DEFAULT 0
);

-- Seed rows on world creation:
INSERT OR IGNORE INTO telemetry (provider) VALUES ('text');
INSERT OR IGNORE INTO telemetry (provider) VALUES ('image_gen');
INSERT OR IGNORE INTO telemetry (provider) VALUES ('tts');
```

### 4.2 Read / Write Strategy

- **On app launch / world open:** Load all three rows into `AppState.rate_limiter`.
  Call `tick_windows()` immediately to expire stale windows from before restart.
- **After every `record_usage()` call:** `UPDATE telemetry SET ... WHERE provider = ?`
- **On `reset_rate_limiter()` (Dev tab):** Zero all counters, persist, emit to frontend.

This ensures RPD accuracy survives app restarts.

---

## 5. Tauri Commands

```rust
#[tauri::command]
pub async fn check_rate_limit(
    state: tauri::State<'_, AppState>,
    provider: String,
) -> Result<RateLimitStatus, String>

#[tauri::command]
pub async fn get_telemetry(
    state: tauri::State<'_, AppState>,
) -> Result<TelemetrySnapshot, String>

#[tauri::command]
pub async fn reset_rate_limiter(
    state: tauri::State<'_, AppState>,
) -> Result<(), String>
```

```rust
#[derive(serde::Serialize)]
pub struct TelemetrySnapshot {
    pub text:      ProviderCounters,
    pub image_gen: ProviderCounters,
    pub tts:       ProviderCounters,
}
```

---

## 6. Frontend Integration

### 6.1 Telemetry Store (`src/stores/telemetryStore.ts`)

```ts
interface TelemetryStore {
  text:      ProviderCounters;
  image_gen: ProviderCounters;
  tts:       ProviderCounters;
  refresh:   () => Promise<void>;
}
```

`refresh()` calls `get_telemetry()`. Called:
- On Workspace mount
- After every `record_usage()` (triggered by message send returning)
- After every Ghostwriter request completing
- On `reset_rate_limiter()` confirm

### 6.2 Control Pane Telemetry Bars

Three bars in the Control Pane `USAGE` section:

```
USAGE
──────────────────────────────────────────
RPM   ████████░░  8 / 10
TPM   ████░░░░░░  98,432 / 250,000
RPD   ██░░░░░░░░  312 / 1,500
```

Bar fill color thresholds:
- < 60%  → `--color-success` (emerald)
- 60–80% → `--color-warning` (amber)
- > 80%  → `--color-error` (rose)

Label: `{current} / {limit}` with `toLocaleString()`.
Limits read from `settingsStore.all`.

### 6.3 Collapsed Pane Rate Limit Dot

When Control Pane is collapsed, status dot on collapse toggle.
Full specification in `10-Control-Pane.md §1.2`.

### 6.4 Rate Limit Banner (Theater)

When `check_rate_limit()` returns `can_proceed: false`, render amber banner
above input area. Full specification in `03-Empty-States-and-Edge-Case-UI.md §1.3`.

### 6.5 Soft Enforcement

Rate limiting is **soft** — the UI prevents sending, but there is no hard
block at the Tauri command level. If the user bypasses the UI and sends anyway,
the request proceeds and Google returns a 429 if quota is truly exhausted.

---

## 7. 429 Handling

If Google returns 429 (`RESOURCE_EXHAUSTED`):

1. `send_message` returns `Err("RATE_LIMITED: …")`
2. Frontend shows rose error banner (see `03-Empty-States-and-Edge-Case-UI.md §1.5`)
3. No automatic retry
4. `record_usage()` is NOT called (failed request — counters not incremented)
5. Rate limit banner shown simultaneously

Same handling applies to Ghostwriter requests that receive 429.

---

## 8. Multi-Provider Stub Requirements (v1)

In v1, `image_gen` and `tts` provider slots must:
- Have seed rows in `telemetry` table
- Be loaded into `AppState.rate_limiter` on startup
- Be included in `TelemetrySnapshot`
- Have counters always at zero and never incremented

This allows v1.1 and v2 to activate these slots by wiring up
`record_usage("image_gen", tokens)` without schema or struct changes.

---

## 9. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `check_rate_limit` | `provider: String` | `RateLimitStatus` |
| `get_telemetry` | — | `TelemetrySnapshot` |
| `reset_rate_limiter` | — | `()` |