# Design-Session Coworking Mode

> **Audience:** New agents picking up LOOM 2.0 design work (or any similarly structured spec phase).
> **Purpose:** Capture the working rhythm that has produced D-08 through D-16 efficiently. Read once before your first design pass.

This is a *process* document, not a content document. It tells you **how** to run a design session, not **what** to write. The "what" lives in the doc you're working on.

---

## The Loop

Every design session follows the same six phases. Don't skip phases; don't reorder them.

```
1. Discovery       — read stub + v1 PRDs + cross-doc refs + memory notes
2. Picture-back    — write "What's already locked" + "What's open" to the user
3. Numbered Qs     — propose answers, label genuinely-open vs confirmations
4. Implications    — second round if the answers cascade into new Qs
5. Write           — one Write call for the new doc; one for any future-doc carry-forward
6. Propagate       — amend every downstream doc; update TODO + 00-INDEX
```

Each phase has a discipline. Skipping discipline costs the user time and re-work.

---

## 1. Discovery

Before you write a single question, read:

- The current stub (`docs-v2/features/<NN>-<name>.md` — usually 30–50 lines of section headers).
- The v1.0 PRD(s) for the same feature (`PRDs/<NN>-*.md` and `PRDs/PATCH-<NN>-*.md`). v1 is what's actually been built; v2 is the redesign. Reading v1 tells you what writers actually use and what bugs got documented.
- Project-memory notes (`C:\Users\Adrian\.claude\projects\D--Proj-LOOM\memory\`) — especially any `project_<feature>_fix.md` or `feedback_<topic>.md`. These capture lessons that aren't in any PRD.
- Cross-doc references — grep `docs-v2/` for the feature name. Other complete docs may already lock parts of the design (Doc 03 schema, Doc 06 stores, Doc 07 commands, Doc 11 interactions, Doc 27 visuals, Doc 22 cache rules, etc.).

**The output of Discovery is a mental model, not a file.** You should be able to answer: what's the feature for, what's already locked, what changed structurally between v1 and v2, what bugs / lessons exist.

If a v1 PRD has a known bug fix in memory (e.g. ghostwriter's surgical-stitching), v2.0 should adopt the corrected design from the start. Don't carry forward known-broken patterns.

---

## 2. Picture-back

Write a structured "here's what I see" message to the user. Sections:

- **What's already locked** — bullet list of schema, behaviour, cross-doc rules. Cite the doc.
- **What's changed since v1** — load-bearing differences. If a v1 mechanism is gone (branching, output-length, per-turn images), state it explicitly.
- **What's genuinely undecided** — preview the question themes.

This is your contract with the user. They can disagree before you've written 12 questions on top of a wrong premise.

---

## 3. Numbered Questions

The single most important format. Rules:

- **Number them sequentially:** Q1, Q2, Q3 …
- **Multiple-choice when possible.** Three numbered options is the sweet spot. Two is a forced binary; four+ becomes "design by committee."
- **Within each question, options come BEFORE the lean.** Order:
  1. Question framing — one sentence.
  2. Numbered options (1) / (2) / (3) — each with a brief explanation of what that option *means* and what its tradeoff is. The reader should understand the option without already knowing the answer.
  3. Then `Lean: (N).` with the rationale.

  Listing the lean first biases the read. Terse options (e.g. `(1) triad; (2) single token; (3) reuse`) force the user to expand the abbreviation in their head — explain the option in the same breath you offer it. One short clause per option for confirmations; two clauses for genuinely-open ones. Keep the structure consistent across the whole batch — don't mix orders within a single message.
- **Every question still states your lean.** Never `"What should we do about X?"` — always end with `Lean: (2). Reasoning: […].`
- **Distinguish genuinely-open from confirmations.** At the end of the list, summarise: *"The genuinely-open ones are Q1, Q3, Q5; the rest are confirmations of v1 carry-forward."* This tells the user where to spend thinking time.
- **Cap the count.** 8–13 questions per pass is the comfort range. More than 15 means you're conflating the design pass with the write — split the session.
- **Flag contradictions you've found.** If Doc 11 says one thing and the v1 PRD says another, name the conflict and ask which wins. Don't silently pick.

The user will reply with `Q1: 2 Q2: confirmed Q3: <choice>` style. Be ready to read that format. Apply each answer literally — if they say "confirmed" you don't second-guess.

---

## 4. Implications round (when needed)

After the answers land, do a quick pass:

- **State implications you're assuming** — schema deltas, new state fields, downstream doc edits — *before* writing. Confirm the user agrees.
- **Surface any follow-up questions** the answers created. Number these too (Q-A, Q-B for the round-2 set, so they're distinguishable).
- **If the user's answer contradicts a previous lock**, flag it. Either the previous lock changes (and you'll amend the affected doc) or the user reconsiders.

This round is sometimes skipped if the answers were all confirmations and no schema deltas fell out. Use judgment.

---

## 5. Write

Write the doc in **one Write call**. Not incrementally. Reasoning:

- The structure of a feature doc is consistent (Overview, Behaviour sections, Data Requirements, Backend API, Frontend State, Edge Cases, Out of Scope, Cross-References). Write it linearly; don't ping-pong.
- Incremental Edits invite drift in tone, density, and section ordering. A single Write produces a coherent voice.
- The user reviews the file as a whole.

Length target: 250–600 lines depending on feature surface. Doc 16 was 586; Doc 18 was ~370; Doc 19 (slim) was ~360. If you're under 200 you're probably skipping detail; over 700 you're padding.

**Front matter every doc gets:**

```markdown
# NN — Feature Name

> **Status:** Complete
> **Last updated:** YYYY-MM-DD — first full design pass; <one-line summary of locked decisions>
> **Scope:** <one paragraph — what this doc owns and what it doesn't>
```

**Sections every feature doc gets** (in this order, adapt as needed):

1. Overview / problem framing
2. Locked decisions / scope statement
3. Behaviour sections (the meat)
4. Data Requirements (schema deltas if any; otherwise just cite Doc 03)
5. Backend API (commands + signatures + preconditions + errors)
6. Frontend State (delta to existing stores; rarely a new store)
7. Edge Cases and Error Handling (table form)
8. Out of Scope (what's explicitly *not* in this doc)
9. Cross-References (other docs and what they own)

**Future-doc pattern.** When something is cut from v2.0, capture it in `docs-v2/future/<feature>.md`:
- Header: `Status: Design captured for v2.1 — not implemented in v2.0`
- v1 spec summary (verbatim if useful)
- What v2.0 changes (new architecture this design has to fold into)
- Architectural options for v2.1 (with recommendation)
- Schema deltas
- Open questions for v2.1
- Migration story from v2.0

This means v2.1 has zero re-discovery cost. Examples: `future/source-document-creator.md`, `future/media-generation.md`, `future/undo-redo.md`.

---

## 6. Propagate

Every umbrella decision **affects** other docs. Propagation is not optional — drift is the project's mortal enemy.

**Standard propagation set** (omit any that aren't actually affected):

| Target | When to touch |
|---|---|
| Doc 03 (Data Model) | New columns, new tables, new enum values, new app/world settings keys |
| Doc 06 (Frontend Architecture) | New store fields, new actions; almost never a new store (resist this) |
| Doc 07 (IPC Contracts) | New commands; flip skeletons → specified; new events |
| Doc 11 (Interaction Patterns) | New keyboard shortcuts; new escape-chain priorities; new selection rules |
| Doc 14 (Vault and Worlds) | Anything that touches vault item lifecycle |
| Doc 15 (Conversation Engine) | Anything that interacts with `isGenerating`, history assembly, or message lifecycle |
| Doc 22 (Context Caching) | Anything that mutates a cached prefix → new stale trigger |
| Doc 27 (Theater Composition) | Anything visible in the Theater; bubble structure changes |
| `TODO.md` | Close resolved items; add D-NN + per-resolution entries; update DEFERRED tables |
| `00-INDEX.md` | Flip Doc status; add D-NN umbrella entry |

**Date-stamp every amended doc's header.** Add a "Last updated" line; preserve the previous one as "Earlier:". Future readers need the diff trail.

**The D-NN umbrella entry in 00-INDEX.md** is the canonical record. Format:

```markdown
### D-NN — <Feature> Umbrella (YYYY-MM-DD)

**Decision:** <Doc XX> is fully specified. Umbrella decision covering <feature> architecture:

| Sub-decision | Locked value |
|---|---|
| <key topic> | <one-sentence resolution> |
| ... | ... |

**Rationale:** <2–4 sentences on why this design over alternatives>

**Affects:** Doc XX (full spec); Doc YY (what changed); Doc ZZ (what changed).
```

Sub-decisions table is the durable artifact. Six months later when someone asks "why does X work this way?", the table is the answer.

---

## Working Rhythm With the User

Patterns that have worked:

- **The user often answers in flight** — `"Q1: 1 Q2: confirmed Q3: do both"`. Be ready to apply, explain, *and* execute in the same turn. No follow-up "should I proceed?" — proceed.
- **The user has authority.** When they say "(2)" or "all modes," that's the decision. Don't relitigate.
- **Pushback is invited but bounded.** If the user's answer creates a structural problem, flag it (`"This contradicts D-XX — should we amend?"`) and continue. Don't refuse to apply; surface and apply.
- **Brevity beats thoroughness in conversation.** Save the thoroughness for the doc. The user reads your messages live; they read the doc once.
- **Always end with a summary.** What was created, what was amended, what's next on the path. Three short sections. No padding.

---

## Anti-patterns

Things that have wasted time when you slip:

- **Asking open-ended questions.** `"How do you want X to work?"` is laziness. Propose an answer.
- **Writing without Discovery.** Skipping the v1 PRD or memory notes means you'll re-derive what's already known and miss the bugs.
- **Incremental writes.** Multiple Edits to a fresh doc instead of one Write. Produces drift.
- **Forgetting propagation.** A locked decision that doesn't propagate is a future contradiction. Always update TODO + 00-INDEX + every affected doc *in the same session*.
- **Adding a new store.** The bias is *no new stores*. Accordion (D-12), Ghostwriter (D-14) both extended `workspaceStore` rather than creating new stores. Resist the eighth store unless the lifecycle genuinely doesn't fit.
- **Re-asking settled questions.** If `00-INDEX.md` D-NN locks something, don't re-open it without explicit reason. Cite the D-NN.
- **Treating v1 as gospel.** v1.0 has bugs (ghostwriter return-only-rewrite was wrong; selection-first in Doc 11 contradicted Doc 17). v2.0 is a clean rewrite — adopt the corrected design from the start.
- **Skipping the "genuinely-open vs confirmations" classification.** Without it, the user has to read 12 questions linearly to know which need thought.
- **Writing the umbrella entry from memory at the end.** Open the actual doc you wrote and pull the locked sub-decisions into the table. Otherwise the table drifts from the spec.

---

## File-touching shortcuts

Specific commands / patterns that come up often:

- **Find cross-doc references**: `Grep "<feature_name>" docs-v2/`. Always do this before writing — there are usually 3–5 already-existing references that constrain the design.
- **Check schema for the feature**: `Grep "<column_name>\|<table_name>" docs-v2/foundation/03-data-model.md`. Don't invent schema; use what's there.
- **Find v1 lessons**: `ls C:/Users/Adrian/.claude/projects/D--Proj-LOOM/memory/`. Look for `feedback_*.md` and `project_*.md`.
- **Verify a doc landed**: `Grep "Doc NN\|D-NN\|<key term>" docs-v2/00-INDEX.md docs-v2/TODO.md`. Quick sanity check that propagation worked.

---

## Quality bar

Before declaring a session done:

1. The new doc compiles (markdown renders; no broken links to other doc sections).
2. Every "Affects" entry in the D-NN block actually has a header date-stamp matching today.
3. TODO.md has a closing entry per resolved O/Q item.
4. 00-INDEX.md status flipped to Complete.
5. Cross-doc references in the new doc point at sections that exist.
6. The summary you sent the user matches what's actually in the files (`grep` to verify).

---

## Tone notes

- LOOM is a passion project; treat the docs that way. No "boilerplate-ese."
- ⚠️ provisional values are fine for visual/numeric details. Mark them and move on; the visual phase tunes them.
- Avoid emojis except where they're load-bearing in the design (`✦` Ghostwriter glyph, `📎` paperclip). The doc is technical, not decorative.
- Cross-references are first-class: `(Doc 22 §Stale Triggers)` not `(see caching)`. Section names are the contract.
- When the user says something matters ("aesthetics matter," "no toasts," "writers don't think in version numbers"), encode that in the spec — not just the rationale.

---

## When the loop breaks

Sometimes a session fails. Common causes:

- **The user's answers reveal the question framing was wrong.** Stop writing; re-do Picture-back with the new frame.
- **A "settled" decision turns out to need amendment.** Open the existing D-NN, add an `#### Amendment` block (don't edit the original). Note the date and reason.
- **You discover a schema delta after writing the doc.** Touch Doc 03 explicitly; don't bury the change inside the feature doc.
- **The propagation surface is bigger than you estimated.** Pause, list every affected doc explicitly, then propagate one at a time. Don't try to hold the whole graph in working memory.

---

## Final test

When the session is done, ask: *"If a fresh agent came in tomorrow, would they have everything they need to either start implementation or continue planning?"* If yes, you're done. If no, finish propagation.

That's the whole rhythm. Discovery → Picture-back → Numbered Qs → Implications → Write → Propagate. Repeat for each feature doc. The system scales because every step has a clear input, a clear output, and a clear handoff.

---

## Pre-implementation audit (2026-05-03)

At the close of the planning phase, before any LOOM 2.0 code was written, a full cross-doc audit was performed against every spec in `docs-v2/`. Findings are catalogued in [`PRE-IMPLEMENTATION-AUDIT.md`](PRE-IMPLEMENTATION-AUDIT.md) — Hard Blockers, Cross-Doc Inconsistencies, Schema Drift, IPC Drift, Stub Doc Gaps, Soft Blockers, Provisional / non-blocking, and TODO items confirmed still load-bearing.

**That file is a checklist, not just a record.** Each finding is a `- [ ]` item with an Owner Doc and a resolution lean.

**Rule for any agent (planning or implementation) who resolves an audit item:**

1. Make the doc edit(s) the item calls for, following the standard Propagate phase (§6).
2. Flip the item's checkbox from `- [ ]` to `- [x]` in `PRE-IMPLEMENTATION-AUDIT.md`.
3. Append a one-line note to the §Resolution log at the bottom of that file: date, item ID, what was edited, whether a new D-NN was added.
4. Do not delete the resolved item — the trail matters.

If a finding turns out to be wrong (the audit miscalled it), still tick it but write `(YYYY-MM-DD — wrong call: <reason>)` so future readers know the audit was reconciled, not silently dropped.

The audit is a one-time artefact; once every box is ticked, it becomes pure history. New drift discovered after that date does not go back into this file — it goes into a new amendment block in `00-INDEX.md` or, if maintainability-related, into `IMPROVEMENT-BACKLOG.md`.
