# 01 — Vision and Principles

> **Status:** Complete
> **Last updated:** 2026-04-26

---

## Product Identity

LOOM is a local-first, privacy-first desktop application for AI-assisted creative fiction writing. The writer directs AI-generated prose through structured input; all data is encrypted locally; the only external service is the AI.

LOOM is not a chatbot with a writing skin. It is a professional writing instrument that happens to use AI. The distinction is felt in every interaction: the chrome recedes, the text dominates, the writer is always in control.

---

## Target User

Serious fiction writers who want AI assistance without surrendering their work to a cloud service. They:

- Value **privacy** — their stories are their own, not training data
- Value **craft** — they direct the AI; the AI does not direct them
- Value **control** — over aesthetics, pacing, voice, and branching narrative
- Spend **long, focused sessions** inside a single story
- Are comfortable with a desktop application and a degree of configuration

This user is not a casual experimenter. They chose LOOM over cloud writing tools deliberately.

---

## What LOOM Refuses to Do

These are permanent product constraints, not deferred features:

- **No cloud sync.** All data lives on the writer's machine, encrypted. There is no LOOM server, no account, no backup-to-cloud.
- **No external network requests except to the Gemini API.** No analytics, no telemetry, no font CDN, no update pings that phone home with usage data.
- **No light mode.** The application is dark only. This is an aesthetic commitment, not a resource limitation.
- **No mobile.** Desktop only. Mouse and keyboard. The writing experience is designed for a full-size screen and deliberate input.
- **No AI that talks back as an AI.** In Story mode, the AI outputs only story prose. It never breaks character to say "As an AI, I..." or offers unsolicited commentary. Modes (Handover, Consulting) provide structured alternatives when the writer needs meta-discussion — but story mode is sacrosanct.

---

## Modes

v2.0 introduces Modes — a first-class concept that changes the AI's role without leaving the story.

| Mode | AI role | Purpose |
|---|---|---|
| **Story** | Author | Generates only story prose, never breaks character |
| **Handover** | Analyst | Produces a structured briefing document for handing the story to another writer or AI |
| **Consulting** | Editor/consultant | Meta-discussion about the story — the AI can reflect, suggest, and respond to questions |

Story mode is the default. It is how LOOM has always worked. Handover and Consulting are parallel contexts that do not contaminate the story thread.

*Full mode behavior is specified in Doc 23 (Modes). Consulting mode has open design questions — see TODO.md.*

---

## Aesthetic Direction

**Adjectives:** editorial, austere, focused, unhurried, precise

**Reference points:** Craft (dark mode), Bear (dark mode), early Linear

**The feeling:** A professional writing instrument. Not a tech demo. Every pixel that is not helping the writer is in the way.

Specific implications:
- Chrome recedes. Navigation and controls are present but do not compete with the text.
- Typography is the primary design element. The prose area gets the best font, the most breathing room, the highest contrast.
- Empty states are atmospheric, not clinical. A blank story does not display a generic "No items" message — it invites.
- Animations are purposeful and short (150–300ms). Nothing feels sluggish or jumpy.
- Errors are handled gracefully. The app never crashes silently or shows a raw stack trace.

---

## Hard Constraints

These are not revisitable without a major version decision:

| Constraint | Detail |
|---|---|
| **Dark theme only** | No light mode; no light-theme color mapping |
| **CSS variable architecture** | All design values through tokens in `08-design-tokens.md`; no hex codes in components |
| **Minimum window** | 1100 × 700 px (enforced in `tauri.conf.json`) |
| **Accent color is dynamic** | Every world has its own accent color (free hex, user-configurable); designs must work with any hue |
| **Resizable panes** | Left 200–360 px, Right 240–400 px, Center flex; designs must work across the full range |
| **No external assets** | Fonts, icons, and images are all local; icon set is `lucide-react` (outline, consistent stroke weight) |
| **Platform** | Desktop (Tauri v2 / WebView); no touch; mouse + keyboard only |

---

## Quality Bar

Before any feature is considered complete:

1. **It compiles without warnings.** Both `cargo build` and `tsc --noEmit`.
2. **All specified behaviors work.** Not just the happy path — what happens when the Gemini call fails, the DB is locked, the network is down?
3. **Empty states are rendered.** Not blank screens — specific messages with specific actions per Doc 12.
4. **It is visually consistent with the design docs.** Correct tokens, sizes, spacing. If in doubt, check Doc 08.
5. **Sensitive data is protected.** No keys in logs, no content in error messages, no secrets in localStorage. Non-negotiable.
6. **Tauri commands are typed.** Frontend has typed wrappers in `tauriApi.ts`; no raw `invoke()` calls scattered through components.

---

## Known Pain Points from v1.0 (to address in v2.0)

These were identified in the designer brief and are design obligations for v2.0:

- Bubble layout: visual hierarchy between user and AI bubbles unclear
- Empty states: too sparse, not atmospheric
- Settings modal: dense, visually flat, no clear section hierarchy
- World Picker cards: generic card design
- Navigator: folder/story/doc visual distinction too subtle
- Input area: feels utilitarian rather than inviting
- Onboarding wizard: styling underexplored
- General: inconsistent vertical rhythm; spacing feels ad-hoc in places
