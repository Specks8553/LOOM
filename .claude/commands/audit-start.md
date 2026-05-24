Start (or resume) a post-implementation audit phase for LOOM 2.0.

**Read these first, in order:**

1. `CLAUDE.md` — rules of the game.
2. `.claude/rules/audit-workflow.md` — audit-specific rules. The cardinal rule is **observation only** — no edits to source docs or code.
3. `docs-v2/audit/README.md` — folder convention; locate the current audit (the row marked `In progress` or, if none, the most recent).
4. The current audit's **plan file** (`docs-v2/audit/AUDIT-YYYY-MM-PLAN.md`).
5. The current audit's **ledger** (`docs-v2/audit/AUDIT-YYYY-MM.md`) — skim recent findings so you avoid duplicates.

## Steps

1. **Identify the active phase.** In the plan, find the first phase whose `Status:` is `In progress`. If none, find the first `Not started` — that's the next one to begin.

2. **If resuming.** Read the active phase's `Resumption notes:` block. Pick up from the last line. Read any checkpoints still `- [ ]` and the docs/code surfaces they cover.

3. **If starting fresh.** Flip the phase `Status:` to `In progress (last touched YYYY-MM-DD)`. Read every doc and code path the phase's checkpoints reference. Don't skim — the audit's value depends on precise observation.

4. **Confirm the prior phase is checkpoint-clean.** If the audit phase before this one still has unticked `- [ ]` boxes without a wrong-call note, finish it first.

5. **Decide on sub-agent strategy.** For grep-heavy sweeps (Pass B forbidden-patterns, store health, component LOC, etc.), spawn `Explore` or `general-purpose` agents in parallel. Brief each cold. For Pass A doc reviews, prefer reading directly — sub-agents miss content past their read window.

6. **Audit.** Walk the phase's checkpoints in order. For each:
   - Read the surface (doc, code path, lint output, grep result).
   - Tick `- [x]` only when the checkpoint has been observed and either passes (no finding) or has had its finding(s) recorded in the ledger.
   - Append a one-liner to `Resumption notes:` **live** — whenever a finding lands or a checkpoint completes. Never save resumption notes for session-end.

7. **Record findings via `/audit-finding`** — that command enforces the format. Don't write findings free-hand.

8. **Observation only.** If you spot something that screams to be fixed, record it as a finding. Do not edit source docs or code. The only edits permitted are: the plan (checkpoints + resumption notes + status), the ledger (new findings), and `audit/README.md` (status row if it changes). See `.claude/rules/audit-workflow.md` §The cardinal rule.

9. **Use TodoWrite** to track your work within the session. Map open checkpoints to tasks.

## When the phase's checkpoints are all ticked

Run `/audit-verify` before moving to the next phase.

## Special cases

- **B3 inside A1.** `AUDIT-2026-05-PLAN.md` deliberately runs B3 (security red lines) alongside A1 (foundation docs). Other audits may make similar combinations — follow the plan as written.
- **No active audit.** If `docs-v2/audit/` exists but no plan is `In progress`, ask the user whether to start a new audit (which means drafting a new `AUDIT-YYYY-MM-PLAN.md` + `AUDIT-YYYY-MM.md` pair). Don't auto-start.
- **Finding mid-checkpoint that breaks the audit's premise.** If the audit is built on a doc that turns out to be wrong, record the finding and pause — surface to the user before continuing. The audit may need re-scoping.
