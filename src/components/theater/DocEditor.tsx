import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowLeft, FileText, Check, Eye, Edit3 } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { vaultUpdateItemContent } from "../../lib/tauriApi";
import { marked } from "marked";

// ─── Placeholder helpers ─────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

interface PlaceholderMatch {
  start: number;
  end: number;
  text: string;
}

function findPlaceholders(content: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  let m;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(content)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return matches;
}

// ─── DocEditor ───────────────────────────────────────────────────────────────

export function DocEditor() {
  const activeDocId = useWorkspaceStore((s) => s.activeDocId);
  const docContent = useWorkspaceStore((s) => s.docContent);
  const docDirty = useWorkspaceStore((s) => s.docDirty);
  const docName = useWorkspaceStore((s) => s.docName);
  const docSubtype = useWorkspaceStore((s) => s.docSubtype);
  const setDocContent = useWorkspaceStore((s) => s.setDocContent);
  const markDocSaved = useWorkspaceStore((s) => s.markDocSaved);
  const closeDoc = useWorkspaceStore((s) => s.closeDoc);

  const [isPreview, setIsPreview] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showUnsavedGuard, setShowUnsavedGuard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!activeDocId) return;
    try {
      await vaultUpdateItemContent(activeDocId, docContent);
      markDocSaved();
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 300);
    } catch (e) {
      console.error("Failed to save document:", e);
    }
  }, [activeDocId, docContent, markDocSaved]);

  // Auto-save on blur
  const handleBlur = useCallback(() => {
    if (docDirty && activeDocId) {
      handleSave();
    }
  }, [docDirty, activeDocId, handleSave]);

  // ─── Back navigation (with guard) ─────────────────────────────────────────

  const handleBack = useCallback(() => {
    if (docDirty) {
      setShowUnsavedGuard(true);
    } else {
      closeDoc();
    }
  }, [docDirty, closeDoc]);

  const handleDiscard = useCallback(() => {
    setShowUnsavedGuard(false);
    closeDoc();
  }, [closeDoc]);

  const handleSaveAndClose = useCallback(async () => {
    setShowUnsavedGuard(false);
    await handleSave();
    closeDoc();
  }, [handleSave, closeDoc]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+S: save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Escape: close editor (guard if dirty)
      if (e.key === "Escape") {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, handleBack]);

  // ─── Tab navigation for placeholders ───────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Tab") return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      const placeholders = findPlaceholders(docContent);
      if (placeholders.length === 0) {
        // No placeholders: insert 2 spaces
        e.preventDefault();
        const start = textarea.selectionStart;
        const before = docContent.slice(0, start);
        const after = docContent.slice(textarea.selectionEnd);
        const newContent = before + "  " + after;
        setDocContent(newContent);
        // Set cursor after inserted spaces
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
        return;
      }

      e.preventDefault();
      const cursorPos = textarea.selectionStart;

      if (e.shiftKey) {
        // Jump to previous placeholder
        const before = placeholders.filter((p) => p.start < cursorPos);
        const target = before.length > 0 ? before[before.length - 1] : placeholders[placeholders.length - 1];
        textarea.setSelectionRange(target.start, target.end);
      } else {
        // Jump to next placeholder
        const after = placeholders.filter((p) => p.start > cursorPos);
        const target = after.length > 0 ? after[0] : placeholders[0];
        textarea.setSelectionRange(target.start, target.end);
      }
      textarea.focus();
    },
    [docContent, setDocContent],
  );

  // ─── Markdown preview ──────────────────────────────────────────────────────

  const renderedHtml = isPreview ? marked.parse(docContent, { async: false }) as string : "";

  // ─── Subtype label ─────────────────────────────────────────────────────────

  const subtypeLabel = (() => {
    if (!docSubtype) return "Source Document";
    switch (docSubtype) {
      case "CharacterProfile": return "Character Profile";
      case "WorldBuilding": return "World Building";
      case "image": return "Image";
      default: return docSubtype.replace(/_/g, " ");
    }
  })();

  if (!activeDocId) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 shrink-0 px-4"
        style={{
          height: "44px",
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-pane)",
        }}
      >
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            color: "var(--color-text-secondary)",
            padding: "4px 8px",
            borderRadius: "4px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
          title="Back to Story"
        >
          <ArrowLeft size={14} />
          <span>Back to Story</span>
        </button>

        {/* Doc name + type */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileText size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <span
            className="truncate"
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {subtypeLabel} — {docName}
            {docDirty && (
              <span style={{ color: "var(--color-accent)", marginLeft: "4px" }}>·</span>
            )}
          </span>
        </div>

        {/* Preview toggle */}
        <button
          onClick={() => setIsPreview(!isPreview)}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            color: isPreview ? "var(--color-accent)" : "var(--color-text-secondary)",
            padding: "4px 8px",
            borderRadius: "4px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          {isPreview ? <Edit3 size={14} /> : <Eye size={14} />}
          <span>{isPreview ? "Edit" : "Preview"}</span>
        </button>

        {/* Save button */}
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            backgroundColor: docDirty ? "var(--color-accent)" : "var(--color-bg-hover)",
            color: docDirty ? "var(--color-text-on-accent)" : "var(--color-text-muted)",
            border: "none",
            borderRadius: "6px",
            padding: "5px 14px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: docDirty ? "pointer" : "default",
          }}
        >
          {saveFlash ? <Check size={14} /> : "Save"}
        </button>
      </div>

      {/* Editor or preview content */}
      <div className="flex-1 overflow-auto">
        {isPreview ? (
          <div
            className="doc-preview"
            style={{
              padding: "32px 48px",
              fontFamily: "var(--font-theater-body, var(--font-serif))",
              fontSize: "15px",
              lineHeight: 1.7,
              color: "var(--color-text-primary)",
              maxWidth: "720px",
              margin: "0 auto",
            }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            spellCheck
            style={{
              width: "100%",
              height: "100%",
              padding: "32px 48px",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: 1.7,
              color: "var(--color-text-primary)",
              backgroundColor: "var(--color-bg-base)",
              border: "none",
              outline: "none",
              resize: "none",
            }}
          />
        )}
      </div>

      {/* Unsaved changes guard dialog */}
      {showUnsavedGuard && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 300 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUnsavedGuard(false);
          }}
        >
          <div
            className="flex flex-col gap-3"
            style={{
              width: "380px",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "24px",
            }}
          >
            <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Unsaved changes
            </p>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              &ldquo;{docName}&rdquo; has unsaved changes that will be lost.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowUnsavedGuard(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "6px 14px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  borderRadius: "6px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDiscard}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  padding: "6px 14px",
                  fontSize: "13px",
                  color: "var(--color-text-primary)",
                  cursor: "pointer",
                  borderRadius: "6px",
                }}
              >
                Discard
              </button>
              <button
                onClick={handleSaveAndClose}
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "var(--color-text-on-accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Save and Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
