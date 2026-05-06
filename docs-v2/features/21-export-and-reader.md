# 21 — Export and Reader View

> **Status:** **Deferred to v2.0.x** (no v2.0 implementation). Stub retained for the structural notes already captured.
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: explicit deferral note added (ST-1). World Backup (`.loom-backup` zip) — the only resilience deliverable v2.0 ships — lives in Doc 14 §World Backup. Story-level narrative export (Markdown / plain text / JSON) and Reader View are deferred; this doc will be picked up after v2.0 ships.
> **Earlier:** 2026-04-29 — Doc 23 design pass: confirmed handover and consulting sessions are included in story export
> **Scope:** Reader View (distraction-free reading mode) and export — Markdown, plain text, and JSON formats. **Out of scope for v2.0.**

---

## Deferral note

This document is intentionally a stub in v2.0. Reasons:
- No v2.0 surface produces narrative export — World Backup (Doc 14) covers writer resilience (move worlds between machines, archive); narrative export is a *reader* deliverable that depends on Doc 17 (Ghostwriter history rendering), Doc 19 (full image pipeline), and Doc 23 (handover / consulting transcripts) being settled in their final visual form.
- Reader View is referenced from Doc 11 §Escape Chain as a future entry; no implementation surface exists in v2.0.
- The structural notes below remain valid as a starting point when v2.0.x picks this up — they capture what's already locked from the modes / sessions / export-bundle work.

---

---

## Overview

## Reader View

### Activation / Deactivation
### Layout and Styling
### Navigation within Reader View

## Export

### Markdown Export
### Plain Text Export
### JSON Export (full conversation + metadata)
### Export Scope (story vs. world vs. selection)
### Export Destination (folder picker)

### Session Inclusion

Story export includes:
- All `kind = 'story'` messages (the prose timeline).
- All handover sessions (`kind = 'handover'`), grouped by session, ordered by session creation time. Each session is rendered with its name as a header, followed by its messages in order.
- All consulting sessions (`kind = 'consulting'`), same treatment.

Handover and consulting sessions appear as labelled appendices in the export, distinguishable from the prose. JSON export carries the full session metadata (snapshot, entry message ID, timestamps) for round-trip fidelity. Markdown and plain text exports use simple section headers and omit snapshot detail.

This applies regardless of session collapse state in the Theater — collapse is a UI affordance only.

## User Flows

### Enter Reader View
### Export Current Story
### Export Selection

## Data Requirements

## Backend API

## Frontend State

## Edge Cases and Error Handling

## Out of Scope
