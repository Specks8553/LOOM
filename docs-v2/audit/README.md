# LOOM 2.0 — Audit Folder

This folder holds **post-implementation audits** of LOOM 2.0 — sweeps of docs-v2/ and the codebase looking for drift, gaps, and quality issues after a body of work has landed.

**Not to be confused with** [`../PRE-IMPLEMENTATION-AUDIT.md`](../PRE-IMPLEMENTATION-AUDIT.md), which is the planning-phase reconciliation checklist and is treated as immutable historical record.

---

## How to find the current audit

Audits are named by the date they were started: `AUDIT-YYYY-MM.md` (findings ledger) and `AUDIT-YYYY-MM-PLAN.md` (plan + status).

The **current / most recent audit** is whichever pair has the latest date in its filename and a `Status:` of `In progress` or `Findings pending review` in its plan file.

| Audit | Started | Status | Plan | Ledger |
|---|---|---|---|---|
| 2026-05 | 2026-05-20 | **Complete (2026-05-23)** — Pass A + B + C done; 65 findings; proposal approved (D1–D6); remediation landed (Phase 12.5 + 12.6, backlog R20–R29). Archived in place. | [AUDIT-2026-05-PLAN.md](AUDIT-2026-05-PLAN.md) | [AUDIT-2026-05.md](AUDIT-2026-05.md) |

---

## Conventions

- **Scope:** Each audit covers everything in `D:\Proj\LOOM\` at the audit's start commit, including uncommitted working-tree changes (snapshot recorded in the plan).
- **Format:** Two files per audit — a **plan** (phase list, Testable Checkpoints, Resumption notes, modelled on `IMPLEMENTATION-PLAN.md`) and a **ledger** (numbered findings).
- **Finding IDs:** Severity prefix + sequence: `HB-`, `SB-`, `CD-`, `SD-`, `IP-` (carrying forward the pre-audit taxonomy) plus `CQ-` (code quality) and `DG-` (doc gap). Numbers do not collide across audits — each audit starts fresh at `-01`.
- **Observation only.** Audits do not edit source docs or source code. Findings are entered with evidence (file:line or doc §) and a proposed lean; resolution happens in a follow-up phase added to `IMPLEMENTATION-PLAN.md`.
- **Multi-session.** Audits typically span several sessions. Each phase in the plan has `Status:` / Testable Checkpoints / live `Resumption notes:`, per the CLAUDE.md phase model.

---

## For agents picking this up cold

1. Read this README.
2. Read the most-recent plan file (table above) — find the active phase by `Status: In progress`.
3. Read the most-recent ledger to see what's already been found (avoid duplicates).
4. Read `Resumption notes:` of the active phase to know exactly where the prior session stopped.
5. Continue from there. Tick checkpoints live, append resumption notes live.

The audit is **strictly observational**. Do not edit docs or code while auditing. Findings only.

**One phase per session** for intensive phases (4+ docs, mixed-pass, or code-sweep phases). When a phase's `/audit-verify` runs clean, do not auto-roll into the next phase — surface completion and let the user open a new session. See `.claude/rules/audit-workflow.md` §One phase per session for the full convention.
