use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::error::LoomError;

/// Current telemetry counters for a provider, returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetryCounters {
    pub req_count_min: i64,
    pub req_count_day: i64,
    pub token_count_min: i64,
    pub rpm_limit: i64,
    pub tpm_limit: i64,
    pub rpd_limit: i64,
}

/// Result of a rate limit check — either OK or exceeded with a reason.
#[derive(Debug, Clone, Serialize)]
pub struct RateLimitStatus {
    pub can_proceed: bool,
    pub reason: Option<String>,
}

/// Read the current rate limit settings from the settings table.
fn read_limits(conn: &Connection) -> Result<(i64, i64, i64), LoomError> {
    let rpm: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'rate_limit_rpm'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "10".to_string());
    let tpm: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'rate_limit_tpm'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "250000".to_string());
    let rpd: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'rate_limit_rpd'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "1500".to_string());

    Ok((
        rpm.parse::<i64>().unwrap_or(10),
        tpm.parse::<i64>().unwrap_or(250_000),
        rpd.parse::<i64>().unwrap_or(1500),
    ))
}

/// Roll over windows if they've expired. Resets counters for the new window.
/// - Minute window: if more than 60 seconds have passed since `window_start_min`.
/// - Day window: if the UTC date has changed since `window_start_day`.
fn maybe_roll_windows(conn: &Connection, now: &DateTime<Utc>) -> Result<(), LoomError> {
    let row: (Option<String>, Option<String>) = conn.query_row(
        "SELECT window_start_min, window_start_day FROM telemetry WHERE provider = 'text'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let now_str = now.to_rfc3339();

    // Minute window rollover
    let should_reset_min = match row.0 {
        None => true,
        Some(ref ws) => {
            if let Ok(start) = DateTime::parse_from_rfc3339(ws) {
                now.signed_duration_since(start).num_seconds() >= 60
            } else {
                true
            }
        }
    };

    if should_reset_min {
        conn.execute(
            "UPDATE telemetry SET req_count_min = 0, token_count_min = 0, window_start_min = ?1 WHERE provider = 'text'",
            rusqlite::params![now_str],
        )?;
    }

    // Day window rollover
    let should_reset_day = match row.1 {
        None => true,
        Some(ref ws) => {
            if let Ok(start) = DateTime::parse_from_rfc3339(ws) {
                now.date_naive() != start.date_naive()
            } else {
                true
            }
        }
    };

    if should_reset_day {
        conn.execute(
            "UPDATE telemetry SET req_count_day = 0, window_start_day = ?1 WHERE provider = 'text'",
            rusqlite::params![now_str],
        )?;
    }

    Ok(())
}

/// Check whether a new request is allowed under current rate limits.
/// Rolls windows first, then compares counters against limits.
pub fn check_rate_limit(conn: &Connection) -> Result<RateLimitStatus, LoomError> {
    let now = Utc::now();
    maybe_roll_windows(conn, &now)?;

    let (rpm_limit, tpm_limit, rpd_limit) = read_limits(conn)?;

    let (req_min, token_min, req_day): (i64, i64, i64) = conn.query_row(
        "SELECT req_count_min, token_count_min, req_count_day FROM telemetry WHERE provider = 'text'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    if req_min >= rpm_limit {
        return Ok(RateLimitStatus {
            can_proceed: false,
            reason: Some(format!(
                "RPM limit reached ({}/{}). Wait for the next minute window.",
                req_min, rpm_limit
            )),
        });
    }

    if token_min >= tpm_limit {
        return Ok(RateLimitStatus {
            can_proceed: false,
            reason: Some(format!(
                "TPM limit reached ({}/{}). Wait for the next minute window.",
                token_min, tpm_limit
            )),
        });
    }

    if req_day >= rpd_limit {
        return Ok(RateLimitStatus {
            can_proceed: false,
            reason: Some(format!(
                "RPD limit reached ({}/{}). Daily limit resets at midnight UTC.",
                req_day, rpd_limit
            )),
        });
    }

    Ok(RateLimitStatus {
        can_proceed: true,
        reason: None,
    })
}

/// Record usage after a successful API call.
/// Increments req_count_min, req_count_day, and adds tokens to token_count_min.
pub fn record_usage(conn: &Connection, token_count: i64) -> Result<(), LoomError> {
    let now = Utc::now();
    maybe_roll_windows(conn, &now)?;

    let now_str = now.to_rfc3339();
    conn.execute(
        "UPDATE telemetry SET req_count_min = req_count_min + 1, req_count_day = req_count_day + 1, token_count_min = token_count_min + ?1, last_req_at = ?2 WHERE provider = 'text'",
        rusqlite::params![token_count, now_str],
    )?;

    Ok(())
}

/// Get current telemetry counters for the frontend display.
pub fn get_telemetry(conn: &Connection) -> Result<TelemetryCounters, LoomError> {
    let now = Utc::now();
    maybe_roll_windows(conn, &now)?;

    let (rpm_limit, tpm_limit, rpd_limit) = read_limits(conn)?;

    let (req_min, req_day, token_min): (i64, i64, i64) = conn.query_row(
        "SELECT req_count_min, req_count_day, token_count_min FROM telemetry WHERE provider = 'text'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    Ok(TelemetryCounters {
        req_count_min: req_min,
        req_count_day: req_day,
        token_count_min: token_min,
        rpm_limit,
        tpm_limit,
        rpd_limit,
    })
}

/// Reset all counters for the text provider.
pub fn reset_counters(conn: &Connection) -> Result<(), LoomError> {
    let now_str = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE telemetry SET req_count_min = 0, req_count_day = 0, token_count_min = 0, last_req_at = ?1, window_start_min = ?1, window_start_day = ?1 WHERE provider = 'text'",
        rusqlite::params![now_str],
    )?;
    Ok(())
}
