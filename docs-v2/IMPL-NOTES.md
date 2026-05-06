# LOOM 2.0 — Implementation Notes

> **Last updated:** 2026-04-26

Decisions and notes confirmed during planning that are intentionally deferred to implementation time. Distinct from TODO.md (open design questions that block doc writing) — entries here are already decided in principle, just not yet detailed.

When an entry is acted on, mark it resolved with a date and reference the doc or commit where it landed.

---

## IN-07 — Tauri Command Signatures (deferred to feature doc sessions)

**Context:** Doc 07 (IPC Contracts) documents command domains and names now. Full parameter signatures, return types, and per-command error lists are filled in when each feature doc is written, since the detailed API design happens there.

**Rule:** When writing a feature doc (Docs 13–23), the author must also update the corresponding section of Doc 07 with complete command signatures before the feature doc is marked complete.

**Status:** Open

---

---

## IN-11 — Keyboard Shortcuts (deferred)

The shortcut list and registration pattern are not yet defined. When addressed, the full list goes in Doc 11 (Interaction Patterns) under the reserved "Keyboard Shortcuts" section. Scope levels to define: Global, Pane-specific, Component-specific.

**Status:** Open

---

## IN-09-A — shadcn/ui not installed in v1.0 (add to v2.0 setup)

v1.0 has no `@radix-ui` or shadcn/ui dependencies — all components are custom. v2.0 introduces shadcn/ui as the behavioral layer. Installing and configuring it (CLI setup, component generation, Tailwind v4 integration) is a build setup task for the first implementation session.

**Status:** Open

---

## IN-09-B — Token violations in v1.0 shared components (fix in v2.0)

`TagInput.tsx` uses hardcoded `rgba(124,58,237,...)` values instead of token references (`--color-accent-subtle`, `--color-accent-text`). `ContextMenu.tsx` uses inline `React.CSSProperties` objects. Both must be migrated to Tailwind classes referencing tokens when ported to v2.0.

**Status:** Open

---

## IN-14-A — Story description field (unused, define when surfacing)

The `items` table has a `description` column for stories. It is currently unused in the UI. When a use is defined (e.g. Navigator tooltip, card hover, story header), document the display location in Doc 14 (Vault and Worlds) and update the relevant component spec.

**Status:** Open

---

## RESOLVED

*(none yet)*
