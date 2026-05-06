Resolve a single audit item from `docs-v2/PRE-IMPLEMENTATION-AUDIT.md`.

Usage: `/audit-resolve <ID>` where `<ID>` is the audit identifier (e.g. `HB-3`, `CD-7`, `SD-2`, `IP-9`, `SB-5`, `ST-3`, `NB-2`).

## Steps

1. **Read the item.** Open `docs-v2/PRE-IMPLEMENTATION-AUDIT.md`, find the `<ID>` block. Read: the contradiction described, the affected docs, the proposed lean (if any), and any prior partial-resolution notes.
2. **Sanity-check the lean.** If the proposed lean is wrong or incomplete, push back — do not silently follow a bad lean. Surface the disagreement to the user with a numbered question (Q1, Q2, …) and a recommended alternative. Apply the user's answer literally.
3. **Read the owner doc(s).** Every audit item names the doc(s) it touches. Read those sections in full before editing — partial reads cause partial fixes.
4. **Edit.** Apply the resolution to each owner doc. Cross-doc consistency is the goal: every reference to the changed surface must be updated, not just the primary spec.
5. **Date-stamp every amended doc's header.** Add a `> **Last updated:** YYYY-MM-DD — <one-line summary>` line. Preserve the prior `Last updated:` as `> **Earlier:**`. Pattern matches `docs-v2/00-INDEX.md`.
6. **Update `00-INDEX.md` if the resolution warrants a new D-NN umbrella entry.** If a real architectural decision came out of the resolution (not just a doc-fix), add a new D-NN block. If it was a fix-only, skip — but update the Document Map status row if the affected doc moved from `Complete` to amended.
7. **Tick the box** in `PRE-IMPLEMENTATION-AUDIT.md` (`- [x]`). Append to the §Resolution log at the bottom of that file: one-line entry with date, ID, and what changed.
8. **Commit.** One commit per audit ID. Message: `docs(audit): resolve <ID> — <one-line summary>`.

## Special cases

- **Hard Blockers (HB-\*).** Must be resolved before any feature code on the surface lands. If you discover an HB-* mid-phase, stop the phase and resolve before continuing.
- **Substrate items (SB-\*).** Land their tooling in Phase 0; the rule home for each is in `docs-v2/dev/24-coding-standards.md` (D-18). `/audit-resolve SB-N` mid-Phase-0 ticks the box once both rule and tooling are in.
- **Wrong-call exit.** If the audit item turns out to be wrong (the contradiction was illusory or the lean was incorrect and the original docs were right), tick with `(YYYY-MM-DD — wrong call: <reason>)`. Do not silently skip.
