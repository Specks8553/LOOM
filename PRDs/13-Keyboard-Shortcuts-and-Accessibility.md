# 13 — Keyboard Shortcuts and Accessibility

## Purpose

This document specifies LOOM's keyboard shortcut system and the accessibility
baseline for v1. Shortcuts cover essential frequent actions (~12 shortcuts).
A reference modal is accessible via `?`. Accessibility in v1 is limited to
focus management and focus trapping — no WCAG compliance target, no screen
reader support, no contrast auditing.

> **Coding-agent note:** Global shortcuts are registered in `src/lib/shortcuts.ts`
> using a single `keydown` listener on `window`, active only when
> `uiStore.appPhase === "workspace"`. Suppressed when focus is inside `<textarea>`
> or `<input>` except for explicitly input-aware shortcuts (`Ctrl+Enter`, `Escape`).
> Focus trap logic uses `useFocusTrap(ref)` in `src/hooks/useFocusTrap.ts`.

---

## 1. Global Shortcuts

Active throughout the workspace regardless of focus position (except where noted).

| Shortcut | Action | Suppressed in input? |
|---|---|---|
| `Ctrl+,` | Open Settings modal | No |
| `Ctrl+L` | Lock app | No |
| `Ctrl+R` | Toggle Reader View | No |
| `Ctrl+M` | Toggle Branch Map drawer | No |
| `Ctrl+F` | Focus Navigator filter input | No |
| `Ctrl+/` or `?` | Open Keyboard Shortcuts modal | No |
| `Escape` | Context-dependent (see §1.1) | No |

### 1.1 Escape Priority Chain

`Escape` resolves in this order (first matching condition wins):

| Priority | Condition | Action |
|---|---|---|
| 1 | A modal is open | Close modal |
| 2 | Branch Map drawer is open | Close Branch Map |
| 3 | Feedback overlay is open | Close Feedback overlay |
| 4 | Ghostwriter mode is active | Exit Ghostwriter (discard confirm if diff exists) |
| 5 | Document Editor open + unsaved changes | Trigger unsaved changes guard dialog |
| 6 | Document Editor open + no unsaved changes | Close editor |
| 7 | Reader View is active | Exit Reader View |
| 8 | Otherwise | No-op |

---

## 2. Input Area Shortcuts

Active when focus is inside Plot Direction, Background Information, or
Modificators fields.

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send message |
| `Escape` | Blur current input field (does not trigger global Escape chain) |

`Enter` alone inserts a newline in the Plot Direction textarea.
`Ctrl+Enter` is the only keyboard send trigger.

---

## 3. Document Editor Shortcuts

Active when the Document Editor is open and focus is anywhere in the editor.

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save document |
| `Escape` | Close editor (triggers unsaved changes guard if dirty) |
| `Tab` | Jump to next `{{placeholder}}`; else insert 2 spaces |
| `Shift+Tab` | Jump to previous `{{placeholder}}` |

---

## 4. Keyboard Shortcuts Modal

### 4.1 Open Triggers

- `?` key (focus not in text input)
- `Ctrl+/`
- Not available in onboarding or lock screen

### 4.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Keyboard Shortcuts                                    [✕]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  GLOBAL                                                      │
│  Ctrl + ,          Open Settings                            │
│  Ctrl + L          Lock LOOM                                │
│  Ctrl + R          Toggle Reader View                       │
│  Ctrl + M          Toggle Branch Map                        │
│  Ctrl + F          Focus Navigator filter                   │
│  ?                 This help screen                         │
│  Escape            Close / dismiss                          │
│                                                              │
│  WRITING                                                     │
│  Ctrl + Enter      Send message                             │
│                                                              │
│  DOCUMENT EDITOR                                             │
│  Ctrl + S          Save document                            │
│  Tab               Next placeholder                         │
│  Shift + Tab       Previous placeholder                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- Modal width: `440px`
- Section headers: `10px`, Inter 500, uppercase, `--color-text-muted`
- Shortcut row: key badge left (`monospace, --color-bg-elevated, border-radius: 4px,
  padding: 2px 6px`) + action label right
- Closed by `Escape` (priority 1 in Escape chain) or `[✕]`

---

## 5. Focus Management

### 5.1 Modal Focus Trapping

All modals (`<Dialog />` from shadcn/ui) trap focus using `useFocusTrap(ref)`.
On modal open: first focusable element inside receives focus.
On modal close: focus returns to the element that triggered the modal open.

### 5.2 Lock Screen

Password field auto-focused on render.

### 5.3 New Item Creation

After creating a new vault item (story, folder, document):
- Item appears in tree in edit/rename mode
- Rename `<input>` auto-focused

### 5.4 Feedback Overlay

When Feedback overlay opens (`[◎ Feedback]` click):
- First feedback textarea auto-focused (if any feedback entries exist)
- Else: first empty textarea auto-focused

---

## 6. Accessibility Baseline (v1)

LOOM v1 does NOT target WCAG compliance. The following minimum accessibility
behaviours are required:

- All interactive elements are keyboard-reachable via `Tab` (no keyboard traps
  outside of intentional modal focus traps)
- All buttons have either visible labels or `aria-label` attributes
- All icons used as buttons have `aria-label`
- `<img>` tags have `alt` attributes
- Modals use `role="dialog"` and `aria-modal="true"` (handled by shadcn/ui Dialog)
- `<textarea>` and `<input>` fields have associated `<label>` elements

Screen reader support and contrast auditing are out of scope for v1.

> **Release note (required):** "LOOM v1 does not meet WCAG accessibility
> standards. Screen reader support, contrast auditing, and reduced-motion
> preferences are planned for a future release."

---

## 7. Shortcut Registration Implementation

```ts
// src/lib/shortcuts.ts
export function initShortcuts() {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (useUiStore.getState().appPhase !== "workspace") return;

    const inInput = ["INPUT", "TEXTAREA"].includes(
      (document.activeElement as Element)?.tagName ?? ""
    );

    // Input-aware shortcuts
    if (inInput) {
      if (e.ctrlKey && e.key === "Enter") { triggerSend(); return; }
      if (e.key === "Escape") { (document.activeElement as HTMLElement).blur(); return; }
      return;
    }

    // Global shortcuts
    if (e.ctrlKey && e.key === ",") { openSettings(); return; }
    if (e.ctrlKey && e.key === "l") { triggerLock(); return; }
    if (e.ctrlKey && e.key === "r") { toggleReaderView(); return; }
    if (e.ctrlKey && e.key === "m") { toggleBranchMap(); return; }
    if (e.ctrlKey && e.key === "f") { focusNavFilter(); return; }
    if (e.key === "?" || (e.ctrlKey && e.key === "/")) { openShortcutsModal(); return; }
    if (e.key === "Escape") { handleEscape(); return; }
  });
}

function handleEscape() {
  const ui = useUiStore.getState();
  // Priority chain — see §1.1
  if (isAnyModalOpen())          { closeTopModal(); return; }
  if (ui.branchMapOpen)          { ui.setBranchMapOpen(false); return; }
  if (isFeedbackOverlayOpen())   { closeFeedbackOverlay(); return; }
  if (isGhostwriterActive())     { exitGhostwriter(); return; }
  if (isEditorDirty())           { showUnsavedChangesGuard(); return; }
  if (isEditorOpen())            { closeEditor(); return; }
  if (isReaderView())            { exitReaderView(); return; }
}
```
