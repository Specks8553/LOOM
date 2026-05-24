# Audit Workflow Rules

> **Scope:** Rules governing **post-implementation audits** — the sweeps that live under `docs-v2/audit/`. Not to be confused with `docs-v2/PRE-IMPLEMENTATION-AUDIT.md`, which is the immutable planning-phase reconciliation checklist (`/audit-resolve` operates on that file).

The audit commands (`/audit-start`, `/audit-finding`, `/audit-verify`) reference this file. Don't duplicate these rules into the command files — fix here once.

---

## The cardinal rule — observation only

**An audit does not edit source docs or source code.** Findings are recorded in the audit's ledger; resolution happens later in a separate remediation phase added to `IMPLEMENTATION-PLAN.md`.

The only edits permitted while an audit is in flight:

- The audit's own **plan file** (ticking checkpoints, appending resumption notes, flipping phase status).
- The audit's own **findings ledger** (adding entries, never silently revising prior ones).
- The audit's **folder README** (only to update the "current audit" status row).

Anything else is a contract violation. If you spot something while auditing that begs to be fixed *right now*, record it as a finding and move on.

---

## Folder & file convention

- Audits live in `docs-v2/audit/`.
- One audit per pair of files: `AUDIT-YYYY-MM-PLAN.md` + `AUDIT-YYYY-MM.md` (ledger).
- The folder `README.md` always lists the current audit; agents picking up cold read it first.
- The most-recent in-progress audit is the active one. If two audits are open, that's a bug — close one before opening another.

---

## Severity taxonomy

Carried forward from `PRE-IMPLEMENTATION-AUDIT.md`, extended for code findings:

| Prefix | Meaning | Resolution timing |
|---|---|---|
| `HB-` | Hard Blocker | Must fix before next feature phase starts |
| `SB-` | Soft Blocker (substrate) | Must fix before the phase that depends on it |
| `CD-` | Cross-Doc inconsistency | Must fix before the touching feature ships |
| `SD-` | Schema drift | Must fix before the touching feature ships |
| `IP-` | IPC drift | Must fix before the touching feature ships |
| `CQ-` | Code Quality | Prioritised; not all are blocking |
| `DG-` | Doc Gap | Prioritised; not all are blocking |

Numbering is **per-audit, starting at `-01`**. IDs do not collide across audits because each audit's filename carries the date.

---

## Finding format

Every finding is recorded in the active ledger as:

```
### <ID> — <one-line summary>

- **Severity:** HB / SB / CD / SD / IP / CQ / DG
- **Phase:** A1 / B2 / etc. (which audit phase found it)
- **Surface:** doc path or code path
- **Evidence:** `file:line` or `Doc NN §section`, with verbatim quote where short
- **Observation:** what's wrong / inconsistent / missing
- **Proposed lean:** one sentence on a likely resolution direction (no commitment — just a starting point for the eventual remediation phase)
- **Cross-refs:** other finding IDs this relates to (if any)
```

If evidence requires a multi-line quote, indent it as a fenced block. Never elide evidence — the resolver in the future phase must be able to find the issue without re-doing your work.

---

## Resumption-notes rhythm

Same rhythm as implementation phases (CLAUDE.md §The phase model):

- Append a one-liner to the active phase's `Resumption notes:` block **whenever** you finish a checkpoint, record a finding, hit a non-trivial decision, or leave something half-done.
- **Live, not at session end.** Sessions end abruptly.
- At natural session-end you tidy the block — consolidate, drop superseded lines, leave a final one-liner the next agent can read cold.

---

## One phase per session (intensive phases)

Intensive audit phases — those spanning four or more docs, or any mixed-pass phase (A1+B3, future A4 etc.) — run **one phase per session**. Do not start a new phase in the same session that completed a prior one, even if the prior phase was small.

Why: precise observation is the audit's only output. A fresh session means a fresh context window, no thread fatigue, and the next `/audit-start` reads the plan + ledger cold — which is exactly the orientation the audit asks of its findings' eventual resolvers. Stuffing multiple intensive phases into one session degrades the later ones.

Which phases qualify as intensive (for AUDIT-2026-05):
- **A1** — Docs 01–03 + the six B3 grep sweeps (9 checkpoints).
- **A2** — Docs 04–07 (4 checkpoints but every doc cross-checked against backend + frontend code).
- **A3** — Docs 08–12 + 27 (6 docs).
- **A4** — Docs 13–23, 28, 29 (13 docs).
- **B1, B2, B4, B6, B7** — code-quality sweeps with their own context demands.

Light phases that may pair (with explicit caller approval): **A5** (3 dev docs) + **A6** (cross-doc/meta) + **A7** (PRE-AUDIT reconciliation walk) — combine only if the session is fresh and the prior phase ended cleanly within it.

**Practical effect:** when an `/audit-start` invocation completes one phase and runs `/audit-verify` clean, do **not** auto-roll into the next phase. Surface the completion, leave the next phase's `Status: Not started`, and let the user open a new session for it.

---

## Sub-agent budget

Audits encourage parallel sub-agents (`Explore`, `general-purpose`) for grep-heavy sweeps — especially B2 (forbidden patterns) and B4 (component & store health). Brief them cold per the Agent tool's own guidance: state the goal, give file paths and the question, ask for a short report. Don't duplicate work the sub-agent is doing.

For Pass A docs-audit phases, prefer reading docs directly — sub-agents have a shorter read window and can miss content past it.

---

## What a finding is *not*

- Not a fix request — record observation + lean only.
- Not a code edit — never "let me just quickly correct this."
- Not a doc edit — same rule.
- Not a duplicate — grep the ledger before adding.
- Not a personal opinion divorced from spec or principle — every finding cites doc § or file:line evidence.

---

## End of audit

When all phases of the active audit are checkpoint-clean, Pass C produces the punch list and a proposed remediation phase. That proposal is presented to the user. **Only after the user approves it** does any edit to `IMPLEMENTATION-PLAN.md` land — and that edit is itself a phase, not an audit operation.

After remediation lands, the audit pair is archived in place (kept as-is for historical record). The folder README's "current audit" row is updated.
