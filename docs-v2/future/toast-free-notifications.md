# Future — Steering Away From Toasts

> **Status:** Design *direction* captured for a future release — **no v2.0 change**
> **Captured:** 2026-05-17 from the Phase 12 Designfiles reconciliation session
> **v2.0 position:** Toasts remain as specified. Doc 12 §Error Display Hierarchy is unchanged.

The owner has stated a preference to **move away from toast notifications** over time. This is recorded as a direction, not a v2.0 work item — toasts ship in v2.0 exactly as the current spec describes. The intent is to revisit the notification model in a later release and reduce or eliminate the toast tier.

This file exists so the preference is not lost and so a future redesign starts from a clear brief.

---

## Why

Toasts are a transient, easily-missed, attention-grabbing surface. For a calm, focused writing tool they can feel intrusive and at odds with LOOM's minimal-chrome aesthetic. `COWORKING.md` already lists *"no toasts"* as an example of the kind of preference worth encoding — this is that preference, made explicit.

---

## What toasts currently carry (v2.0)

Per Doc 12 §Error Display Hierarchy, **Toast is the level-1 tier** of a three-tier error system (Toast → Inline → Blocking modal). A future redesign must find a home for everything below before the tier can be removed:

| Current toast use | Examples | Candidate replacement |
|---|---|---|
| Undo confirmations | Soft-delete: "3 items moved to Trash [Undo]" | Hardest to replace — needs a persistent undo affordance (cf. `future/undo-redo.md`, which already rejects toast-with-Undo in favour of title-bar buttons). |
| Transient success | "Document saved", "Password changed", "API key saved" | Likely silent, or a quiet inline confirmation at the originating control. |
| Recoverable errors | Network unreachable, rate limit hit, cache-fallback notice | A persistent, non-modal status/banner channel — possibly the right-pane Status section. |

Inline errors (tier 2) and blocking modals (tier 3) are unaffected — they are not toasts and would stay.

---

## Blast radius (for whoever picks this up)

Removing or shrinking the toast tier is a spec change, not a component swap. It touches:

- **Doc 04** — D-06 picks Sonner as the toast library.
- **Doc 06** — `appStore` owns `toasts: Toast[]` + `pushToast` / `dismissToast`.
- **Doc 07** — `LoomError` variant → display mapping uses toasts heavily.
- **Doc 12** — §Error Display Hierarchy: the level-1 tier itself; ~all of §Error Copy Reference.
- **Docs 13, 14, 15, 16, 22** — ~40 specific toast usages across feature flows.

---

## Out of scope for v2.0

Nothing here is actioned in v2.0. When a future release revisits notifications, start from this brief: decide the replacement channel(s) first, then unwind the docs above.
