# Gap Analysis: Missing Deliverables (Phases 1–11)

> Generated: 2026-03-16
> Last commit: `ded9714` (Phase 7). Phases 8–11 uncommitted but complete.
> Context doc attachment just implemented (uncommitted).

This document lists every deliverable from the implementation plan (Phases 1–11) that is **not yet implemented** or is **incomplete**. Organized by priority.

---

## 🔴 CRITICAL — Phase 10: Rate Limiting + Telemetry

Phase 10 is almost entirely unimplemented. This is the largest gap.

### 10.1 RateLimiter Backend (`rate_limiter.rs`)
- **Status:** File does not exist
- **Required:**
  - `src-tauri/src/rate_limiter.rs` module
  - `ProviderCounters` struct for text (image_gen and tts are stubs)
  - Rolling 60-second RPM window
  - Midnight PT reset for RPD (via `chrono-tz`)
  - `check_rate_limit(provider, settings) -> RateLimitStatus`
  - `record_usage(provider, tokens)`
- **Reference:** Doc 06 (Rate Limiting)

### 10.2 Telemetry Persistence
- **Status:** Not implemented
- **Required:**
  - Load counters from `telemetry` table on world open
  - Write counters after every `record_usage()`
  - `get_telemetry()` Tauri command to return current counters to frontend
- **Bug:** `reset_rate_limiter` command in `lib.rs` uses wrong column names (`rpm_count`, `tpm_count`, `rpd_count`, `last_reset_at`) that don't match the actual `telemetry` table schema (`req_count_min`, `req_count_day`, `token_count_min`, `last_req_at`, `window_start_min`, `window_start_day`). Will silently fail.

### 10.3 Telemetry Frontend Store + UI
- **Status:** Not implemented
- **Required:**
  - `src/stores/telemetryStore.ts` — Zustand store with `refresh()` that calls `get_telemetry()`
  - Update `TelemetryPlaceholder` in `RightPane.tsx` to read real data (currently hardcoded to `used={0}`)
  - Color thresholds: <60% emerald, 60–80% amber, >80% rose
  - Rate limit dot on collapsed Control Pane toggle (6px colored circle)

### 10.4 Rate Limit Integration with `send_message`
- **Status:** Not implemented
- **Required:**
  - Call `check_rate_limit("text", settings)` before making API request
  - Call `record_usage("text", token_count)` after successful response
  - Return `RateLimitExceeded` error if limit hit

### 10.5 Rate Limit Banner (Frontend)
- **Status:** Not implemented
- **Required:**
  - Amber banner above `InputArea` when `can_proceed = false`
  - Shows reason (RPM/TPM/RPD) and countdown timer
  - Send button disabled during banner
  - Auto-dismiss and re-check at countdown zero

### 10.6 429 Error Handling
- **Status:** Not implemented
- **Required:**
  - Rose banner for Google `RESOURCE_EXHAUSTED` errors
  - No auto-retry, no `record_usage` on failed request

### 10.7 Generation Error Banner
- **Status:** Not implemented
- **Required:**
  - Rose banner for non-429 API errors
  - Retry button calls `send_message` again

---

## 🟡 MEDIUM — Phase 8 Gaps

### 8.1 Auto-Lock Timer Logic
- **Status:** UI exists (dropdown in Settings → General saves to localStorage `loom_auto_lock_minutes`), but **no timer logic is wired up**
- **Required:**
  - Idle timeout handler in `App.tsx` or `Workspace.tsx`
  - Track last user interaction (mouse move, keypress, click)
  - Warning toast at T-1 minute per Doc 11 §6
  - Auto-lock on timeout expiry
  - Reset timer on any user interaction

### 8.2 Change Master Password Backend
- **Status:** UI form exists in Settings → Security (current/new/confirm fields), but backend is **stubbed with `toast.error("Password change not yet implemented")`**
- **Required:**
  - `change_master_password(old_password, new_password)` Tauri command
  - Verify old password against sentinel
  - Generate new PBKDF2 salt (Amendment A6)
  - Derive new key, create new sentinel
  - Re-encrypt all world databases with new key
  - Atomic config file write
  - Zero old key material
- **Reference:** Doc 05 §Security, Amendment A6, A9

---

## 🟢 LOW — Minor Gaps

### 9.1 Feedback Overlay "Go to msg" Link
- **Status:** Missing
- **Required:** Each feedback entry in `FeedbackOverlay` (RightPane.tsx) should have a `[→ Go to msg]` link that closes the overlay and scrolls Theater to that specific AI message
- **Reference:** Doc 10 §6.3

### 9.2 Feedback Overlay Slide Animation
- **Status:** Currently no animation (just appears/disappears)
- **Required:** `translateX(100%) → translateX(0)`, 200ms ease
- **Reference:** Doc 10 §6.2

### 6.1 Token Counter in Theater Toolbar
- **Status:** Missing entirely
- **Required:**
  - `~X / 128,000 tokens` display in Theater toolbar area
  - Estimation: `chars / 4` for pre-send, actual counts post-response
  - Color thresholds: muted (normal), warning (>80%), error (>95%)
- **Reference:** Doc 09 §12.1

---

## ✅ Already Complete (Phases 1–11)

For reference, these are confirmed working:

- Phase 1: Scaffold, crypto, config, DB schema, world creation
- Phase 2: Lock/unlock, CSS variables, fonts, error boundary
- Phase 3: Onboarding wizard (4 steps), recovery file
- Phase 4A: World CRUD, World Picker modal
- Phase 4B: Vault tree, create dialog, inline rename, filter
- Phase 4C: Context menus, DnD, multi-select, bulk actions, trash
- Phase 5: Three-pane layout, resizable dividers, viewport watcher, empty states, toast
- Phase 6: Gemini streaming, messages DB + CTE, Theater bubbles, markdown, cancel, constraints field, output length slider, safety filter display
- Phase 7: Branching, sibling nav, regenerate, edit, soft delete + undo, leaf_id persistence
- Phase 8: Settings modal (8 tabs), applyTheme, accent color derivation, modificator presets, model selector, rate limit config UI, template CRUD in settings
- Phase 9: Control Pane (story title/desc, metadata, context docs section, system instructions, feedback overlay + bubble feedback, telemetry placeholder), context doc attach/detach with paperclip icon, Gemini inline injection
- Phase 11: DocEditor, ImageViewer, template-based creation, placeholder navigation

---

## Recommended Implementation Order

1. **Phase 10 (Rate Limiting)** — critical for preventing API abuse and the foundation for telemetry display
2. **Auto-lock timer logic** — security feature, UI already exists
3. **Change master password backend** — security feature, UI already exists
4. **Token counter** — useful UX feedback
5. **Feedback "Go to msg" + slide animation** — polish
