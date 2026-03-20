import { useState, useCallback, useEffect } from "react";
import { ArrowLeft, Image as ImageIcon, Check } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { vaultUpdateItemContent, vaultGetAssetPath } from "../../lib/tauriApi";
import InlineImage from "../shared/InlineImage";

/**
 * Lightbox-style viewer for Image-type source documents.
 * Shows the image centered with a caption field below.
 * Caption is stored in items.content.
 */
export function ImageViewer() {
  const activeDocId = useWorkspaceStore((s) => s.activeDocId);
  const docContent = useWorkspaceStore((s) => s.docContent);
  const docDirty = useWorkspaceStore((s) => s.docDirty);
  const docName = useWorkspaceStore((s) => s.docName);
  const setDocContent = useWorkspaceStore((s) => s.setDocContent);
  const markDocSaved = useWorkspaceStore((s) => s.markDocSaved);
  const closeDoc = useWorkspaceStore((s) => s.closeDoc);

  const [saveFlash, setSaveFlash] = useState(false);
  const [showGuard, setShowGuard] = useState(false);
  const [assetAbsPath, setAssetAbsPath] = useState<string | null>(null);

  useEffect(() => {
    if (!activeDocId) return;
    vaultGetAssetPath(activeDocId)
      .then(setAssetAbsPath)
      .catch(() => setAssetAbsPath(null));
  }, [activeDocId]);

  const handleSave = useCallback(async () => {
    if (!activeDocId) return;
    try {
      await vaultUpdateItemContent(activeDocId, docContent);
      markDocSaved();
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 300);
    } catch (e) {
      console.error("Failed to save caption:", e);
    }
  }, [activeDocId, docContent, markDocSaved]);

  const handleBack = useCallback(() => {
    if (docDirty) {
      setShowGuard(true);
    } else {
      closeDoc();
    }
  }, [docDirty, closeDoc]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, handleBack]);

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
        >
          <ArrowLeft size={14} />
          <span>Back to Story</span>
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ImageIcon size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <span
            className="truncate"
            style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}
          >
            Image — {docName}
          </span>
        </div>
      </div>

      {/* Image display + caption */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-auto" style={{ padding: "32px" }}>
        {assetAbsPath ? (
          <InlineImage assetPath={assetAbsPath} alt={docName} />
        ) : (
          <div
            className="flex flex-col items-center justify-center"
            style={{
              width: "400px",
              height: "300px",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              color: "var(--color-text-muted)",
            }}
          >
            <ImageIcon size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: "12px", marginTop: "12px" }}>
              Loading image...
            </p>
          </div>
        )}

        {/* Caption */}
        <div className="flex items-center gap-2 mt-4" style={{ width: "400px" }}>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", flexShrink: 0 }}>
            Caption:
          </span>
          <input
            type="text"
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            onBlur={() => {
              if (docDirty && activeDocId) handleSave();
            }}
            placeholder="Add a caption..."
            style={{
              flex: 1,
              background: "var(--color-bg-hover)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "6px 8px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
          <button
            onClick={handleSave}
            className="flex items-center justify-center"
            style={{
              backgroundColor: docDirty ? "var(--color-accent)" : "var(--color-bg-hover)",
              color: docDirty ? "var(--color-text-on-accent)" : "var(--color-text-muted)",
              border: "none",
              borderRadius: "6px",
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: docDirty ? "pointer" : "default",
            }}
          >
            {saveFlash ? <Check size={14} /> : "Save"}
          </button>
        </div>
      </div>

      {/* Unsaved guard */}
      {showGuard && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 300 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowGuard(false);
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
                onClick={() => setShowGuard(false)}
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
                onClick={() => { setShowGuard(false); closeDoc(); }}
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
                onClick={async () => { setShowGuard(false); await handleSave(); closeDoc(); }}
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
