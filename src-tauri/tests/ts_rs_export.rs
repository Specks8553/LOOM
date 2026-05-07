//! ts-rs drift-check (SB-3 / Doc 24 §Type Generation).
//!
//! This test triggers `ts_rs::TS::export` for every annotated type, writing
//! each to `src/lib/types.ts` (path declared on the `#[ts(export_to)]`
//! attribute). CI pairs this with `git diff --exit-code src/lib/types.ts` so
//! any drift between the Rust struct and the committed `types.ts` fails the
//! pipeline.

use loom_app_lib::error::{LoomError, ValidationKind};
use loom_app_lib::AppPhase;
use ts_rs::TS;

#[test]
fn export_all_ts_types() {
    LoomError::export_all().expect("LoomError export failed");
    ValidationKind::export_all().expect("ValidationKind export failed");
    AppPhase::export_all().expect("AppPhase export failed");
}
