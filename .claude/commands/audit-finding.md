Record a finding to the active audit ledger.

Usage: `/audit-finding <short description>` (the description seeds the one-line summary; the command walks you through the rest).

**Read first:** `.claude/rules/audit-workflow.md` §Finding format and §Severity taxonomy. Don't draft findings from memory — match the rules verbatim.

## Steps

1. **Locate the active audit.** Read `docs-v2/audit/README.md` to find the in-progress audit. The ledger is `docs-v2/audit/AUDIT-YYYY-MM.md`.

2. **Assign an ID.** Severity prefix + next sequence number within this audit:
   - Severity prefix: `HB-` Hard Blocker, `SB-` Soft Blocker, `CD-` Cross-Doc, `SD-` Schema, `IP-` IPC, `CQ-` Code Quality, `DG-` Doc Gap.
   - Numbering is per-audit, starting at `-01`. Numbers are not reused across severities — `HB-01`, `CD-01`, `CQ-01` can all coexist.
   - Grep the ledger for the next free number in the chosen severity before assigning.

3. **Check for duplicates.** Grep the ledger for the surface (file path or doc §) before writing. If a near-duplicate exists, append a cross-reference to the existing finding's `Cross-refs:` line instead of creating a new one.

4. **Gather evidence.** Open the file or doc at the cited location. Capture either:
   - A precise `file:line` reference, plus a short verbatim quote (≤2 lines), OR
   - A `Doc NN §section` reference plus the relevant quote.

   No paraphrasing in the Evidence line. The future resolver must be able to reproduce the observation without re-doing the investigation.

5. **Write the finding** using the format from `.claude/rules/audit-workflow.md` §Finding format:

   ```
   ### <ID> — <one-line summary>

   - **Severity:** <prefix expanded — e.g. "CQ — Code Quality">
   - **Phase:** <A1/B2/etc — the audit phase that found it>
   - **Surface:** <doc path or code path>
   - **Evidence:** <file:line or Doc NN §section, with verbatim quote>
   - **Observation:** <what's wrong / inconsistent / missing>
   - **Proposed lean:** <one sentence — starting point, not a commitment>
   - **Cross-refs:** <other IDs, or "none">
   ```

6. **Insert into the correct ledger subsection.** Pass A findings go under `## Docs`; Pass B under `## Code`; Pass C synthesis lands later. If the subsection for this audit phase doesn't exist yet, create it (`### Phase B2 — Forbidden patterns` etc.).

7. **Append to the plan's `Resumption notes:`** for the active phase: one line, e.g. `2026-05-21 — recorded CQ-04 (raw .lock() in handover.rs:142).`

8. **Do not commit individual findings.** Findings accumulate across the session. Commit at session-end with a single `docs(audit): findings <date> — <N> entries` commit.

## Special cases

- **The finding is borderline.** If you're unsure whether it warrants recording, record it. The remediation phase can deprioritise; an unrecorded finding is just lost work.
- **The finding contradicts a closed audit item.** If your finding suggests `PRE-IMPLEMENTATION-AUDIT.md` mis-resolved something, record it as a `CD-` finding and cross-ref the resolved item. Don't reopen the old ledger.
- **The finding is a code-quality issue with an obvious one-line fix.** Still record it. The cardinal rule is observation only. Resist the urge.
- **You're not sure of the severity.** Pick the higher one. The synthesis phase (C1) can re-prioritise — under-flagging is worse than over-flagging because the higher-severity sort happens first.
