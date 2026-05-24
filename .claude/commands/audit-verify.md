Verify the current audit phase is complete.

Find the active audit phase in `docs-v2/audit/AUDIT-YYYY-MM-PLAN.md` (`Status: In progress`). Run these checks in order; report pass/fail per item; do not flip `Status:` to `Complete` until every check is green.

**Read first:** `.claude/rules/audit-workflow.md`.

## Checkpoint integrity

1. **Every `- [ ]` in the phase block is now `- [x]`.** Walk them in order. For each checkpoint, the corresponding observation must actually have been done — confirm by either:
   - A finding in the ledger that cites this surface (the checkpoint produced an issue), or
   - A live re-verification that the surface is clean (the checkpoint passed).
   A ticked checkpoint with no finding and no verification trace is a lie — un-tick it and re-do.

2. **No half-done findings.** Grep the ledger for findings recorded under this phase. Every one has:
   - A complete Severity / Surface / Evidence / Observation / Proposed lean / Cross-refs block.
   - A precise `file:line` or `Doc NN §section` evidence reference (no paraphrase).
   - A non-empty proposed lean (even "deprioritise" is a lean; an empty field is not).

## Resumption notes hygiene

3. **`Resumption notes:` is tidied.** Consolidate the live one-liners into a clean trailing summary the next agent can read cold. Drop superseded lines. Leave at minimum: the date the phase started, the date the phase finished, and a one-line summary of findings count by severity.

## Cardinal-rule check

4. **No edits to source docs or source code during this phase.** Run `git diff` against the phase's start commit. The only changed paths should be:
   - `docs-v2/audit/AUDIT-YYYY-MM-PLAN.md` (this audit's plan)
   - `docs-v2/audit/AUDIT-YYYY-MM.md` (this audit's ledger)
   - `docs-v2/audit/README.md` (only if the active-audit row changed)

   Anything else in the diff is a cardinal-rule violation. Revert it before flipping `Status:`. See `.claude/rules/audit-workflow.md` §The cardinal rule.

## Ledger format check

5. **All findings in this phase match the format** in `.claude/rules/audit-workflow.md` §Finding format. No free-hand entries.

6. **No duplicate finding IDs.** Grep the ledger for each ID claimed by this phase — exactly one match each.

7. **No duplicate findings by surface.** Two findings citing the same `file:line` for the same observation should be merged or cross-referenced.

## Outcome

- **All green:** flip the phase `Status:` to `Complete (YYYY-MM-DD)`. Update `docs-v2/audit/README.md`'s active-audit row if this was the final phase of Pass A or Pass B. Commit: `docs(audit): complete <phase> — <N> findings`.
- **Anything red:** report exactly what failed and where. Do not flip `Status:`. The phase is not done. Resume via `/audit-start`.

## When all phases of the audit are complete

`/audit-verify` on the final phase doesn't trigger Pass C automatically. Pass C (synthesis + remediation proposal) is its own audit phase — start it via `/audit-start` as normal.
