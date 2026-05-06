Start a new implementation phase for LOOM 2.0.

Read these in order before doing anything else:

1. `CLAUDE.md` — rules of the game.
2. `docs-v2/00-INDEX.md` — decision log + doc map. Skim the D-NN umbrella table.
3. `docs-v2/IMPLEMENTATION-PLAN.md` — find the **first phase whose `Status:` is not `Complete`**. That is the current phase.
4. `docs-v2/PRE-IMPLEMENTATION-AUDIT.md` — scan for unticked items on the surface this phase touches.

Then walk these steps:

1. **Identify the current phase.** Read its `Status:`, Goal, Inputs, Scope, Testable Checkpoints, Out of Scope, and `Resumption notes:` blocks. If `Resumption notes:` has content, you are continuing — pick up from there.
2. **Hard Blocker gate.** For every `HB-*` audit item that touches this phase's surface: if it is unticked, stop. Resolve it via `/audit-resolve <ID>` before any feature code lands. (Substrate items `SB-*` are required for Phase 0; `CD-*` / `SD-*` / `IP-*` must be resolved before the phase that touches them ships.)
3. **Read every doc the phase's Inputs section references.** Don't skim — these are implementation-ready specs (DDL, Rust structs, TS interfaces, ASCII layouts, exact behavioural rules). Use the PRD lookup table in `CLAUDE.md` if you need to navigate sideways.
4. **Check auto-memory** at `C:\Users\Adrian\.claude\projects\D--Proj-LOOM\memory\` for cross-session context (decisions, lessons, build setup). (Memory dir name is `D--Proj-LOOM` until/unless the repo is renamed.)
5. **Verify the previous phase passed `/phase-verify`.** If not, finish it first — phase progression rule (CLAUDE.md §The phase model).
6. **Set `Status:` to `In progress (last touched YYYY-MM-DD)`.** Edit `IMPLEMENTATION-PLAN.md` directly.
7. **Draft the plan.** Use TodoWrite for the task list. Map each Testable Checkpoint to one or more concrete tasks. Present the plan to the user before implementing if the surface is non-trivial.
8. **Implement.** Tick checkpoints (`- [x]`) as you finish each one. **Update `Resumption notes:` live, not at session end** — append a one-liner whenever you finish a checkpoint, hit a non-trivial decision, or leave something half-done. Sessions can end abruptly; notes saved for later are notes that often never get written.
9. **Commit atomically.** One commit per logical change. Commit messages follow Conventional Commits (Doc 24 §Commit Messages once it exists; until then: `<type>(<scope>): <subject>` with the closed type/scope sets in the spec). Reference the phase number where natural.

When the phase's checkpoints are all ticked, run `/phase-verify`.
