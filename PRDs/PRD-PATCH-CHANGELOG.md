# PRD Patch — Change Log
# Image Upload System: Critical & High Severity Fixes
# Applied: 2026-03-20
---

| # | Issue | Severity | Docs Patched | Resolution |
|---|-------|----------|-------------|------------|
| 1 | File API URI cache location undefined | 🔴 Critical | Doc 19, Doc 12 | Added `file_api_uri` + `file_api_uploaded_at` columns to `items` table. Defined `get_or_upload_file_api_uri()` helper in Doc 19 §5.1 (lives in `vault.rs`). Doc 12 §7.2 updated to call helper instead of raw upload. |
| 2 | File API 48h expiry unhandled | 🔴 Critical | Doc 19, Doc 12 | `get_or_upload_file_api_uri()` checks `file_api_uploaded_at`; re-uploads if age ≥ 47 hours. Error handling table defined for all failure modes. |
| 3 | User message `jsonuser` vs `blocks` contradiction | 🔴 Critical | Doc 09, Doc 19 | `content_type = "blocks"` is now AI-message-only (Doc 20 image gen). User messages always `"jsonuser"`. `UserContent` extended with optional `image_blocks?: ImageBlock[]`. Caption field in `UserContent` is preserved for edit flow repopulation. |
| 4 | Storage path `images/` vs `assets/` contradiction | 🔴 Critical | Doc 12, Doc 19 | Canonicalised to `assets/` (Doc 19 §1.1 definition). Doc 12 §6 updated. No `images/` directory exists. |
| 5 | Caption field vs empty `content` | 🟠 High | Doc 12, Doc 19 | `items.content` stores caption string (empty `""` by default). Doc 19 §2.1 upload step updated. Doc 12 §6 updated to show caption save flow via `vault_update_item_content`. |
| 6 | History assembly missing `blocks` handling | 🟠 High | Doc 09, Doc 19 | `build_user_turn()` signature changed to `async fn(...) -> Vec<Part>`. Image parts (inline base64 ≤4MB / File API >4MB) appended after text part. Doc 09 §4.2 fully rewritten. |
| 7 | Accordion summarisation + image blocks | 🟠 High | Doc 18 | `summarise_segment` now calls `build_user_turn()` for user messages (includes images). `extract_text_for_summarisation()` helper strips image blocks from model `blocks` messages. Error handling table defined. |
| 8 | Ghostwriter + `blocks` messages | 🟠 High | Doc 16 | New section added: text-only selection scope, image block placeholders in Ghostwriter mode, Accept flow reconstructs `MessageBlock[]` preserving image blocks, history stores text blocks only, image-only message edge case handled. |

## Cross-Cutting Impact Notes

- **`build_user_turn` signature change (Doc 09 §4.2):** Returns `Vec<Part>` instead of `String`.
  All callers (`send_message`, `summarise_segment`, Ghostwriter request assembly) must be updated
  to assemble a multi-part `Content` object rather than a plain text string.
  The stored `messages.content` is unchanged.

- **`get_or_upload_file_api_uri` shared helper (Doc 19 §5.1):** Lives in `vault.rs`.
  Called by: `send_message` (context doc images), `build_user_turn` (inline message images > 4MB),
  `summarise_segment` (Accordion). Single source of truth for File API URI lifecycle.

- **`items` table migration:** Two new nullable columns (`file_api_uri`, `file_api_uploaded_at`).
  Handled as an `ALTER TABLE` migration in the DB init / migration path.
  No data loss on existing worlds — columns default to NULL.
