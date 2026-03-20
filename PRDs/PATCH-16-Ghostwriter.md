# PATCH — 16-Ghostwriter.md
# Issue addressed: #8 (Ghostwriter behaviour on model messages with content_type = "blocks")
# Apply: insert this as a new section after the existing "Enter Ghostwriter Mode" section,
#        before "API Request".
---

## NEW SECTION — Ghostwriter on `blocks` Messages

AI messages produced while image generation (Doc 20) is active have
`content_type = "blocks"`, containing interleaved `text` and `image` blocks.
Ghostwriter handles these messages as follows:

### Plain-Text Rendering for Selection

When Ghostwriter mode is entered on a `blocks` message:
- Only `text` blocks are concatenated (in order) for display as plain text.
- `image` blocks are rendered as **non-interactive greyed-out placeholders**
  (a small `lucide-react Image` icon at the image's approximate position).
- Placeholders are not selectable and do not contribute characters to the
  selection offset calculation.

### Selection Scope

Text selection offsets are computed within the **concatenated text-only content**.
Image blocks do not occupy any character positions in the selection space.
The `selected_text` and `original_content` sent to `send_ghostwriter_request`
are derived from the text-only concatenation.

### API Request

`send_ghostwriter_request` passes:
- `original_content`: the concatenated text-only content (text blocks joined).
- `selected_text`, `instruction`: unchanged from the standard flow.

The Ghostwriter prompt operates on text only. Image blocks are invisible to the
Gemini revision call.

### Accept Flow

After the user accepts the revised text:
1. Split the revised text back across the original `text` block positions
   (using the same character-offset mapping built during selection).
2. Reconstruct the full `MessageBlock[]` array:
   - Each `text` block is replaced with the corresponding revised text segment.
   - All `image` blocks are **preserved at their original indices** unchanged.
3. Serialise the reconstructed `MessageBlock[]` back to `messages.content`
   (`content_type` remains `"blocks"`).
4. Append to `ghostwriter_history`:
   ```json
   { "previous_text_blocks": ["...original text block 0...", "...original text block 1..."] }
   ```
   Only text block contents are stored in history — image blocks are not included
   (they are invariant across Ghostwriter revisions).

### Revert

Restoring a previous Ghostwriter version replaces the text blocks with the
stored `previous_text_blocks` values. Image blocks are left untouched.

### Edge Case: Image-Only `blocks` Message

If a `blocks` message contains **no text blocks** (only image blocks), Ghostwriter
mode cannot be entered. The Ghostwriter button is hidden for such messages.
This state can occur if image generation produces an image response with no
accompanying text (provider-dependent).
