import { useState, useCallback } from "react";
import { X, BookOpen, Folder, User, Globe, Image } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";
import { vaultCreateItem, vaultListItems } from "../../lib/tauriApi";
import { useFocusTrap } from "../../hooks/useFocusTrap";

type SourceDocSubtype = "CharacterProfile" | "WorldBuilding" | "Image";

export function CreateNewDialog() {
  const createNewOpen = useVaultStore((s) => s.createNewOpen);
  const setCreateNewOpen = useVaultStore((s) => s.setCreateNewOpen);
  const setItems = useVaultStore((s) => s.setItems);
  const setPendingRename = useVaultStore((s) => s.setPendingRename);
  const selectedItems = useVaultStore((s) => s.selectedItems);
  const items = useVaultStore((s) => s.items);

  const [sourceDocName, setSourceDocName] = useState("");
  const [activeSubtype, setActiveSubtype] = useState<SourceDocSubtype | null>(null);

  const dialogRef = useFocusTrap(createNewOpen);

  const close = useCallback(() => {
    setCreateNewOpen(false);
    setActiveSubtype(null);
    setSourceDocName("");
  }, [setCreateNewOpen]);

  // Determine parent: if a folder is selected, create inside it; otherwise root
  const getParentId = useCallback((): string | null => {
    const selectedArr = Array.from(selectedItems);
    if (selectedArr.length === 1) {
      const selected = items.find((i) => i.id === selectedArr[0]);
      if (selected?.item_type === "Folder") return selected.id;
      // If selected item has a parent folder, use that
      if (selected?.parent_id) return selected.parent_id;
    }
    return null;
  }, [selectedItems, items]);

  const handleCreateSimple = useCallback(
    async (type: "Story" | "Folder") => {
      const defaultName = type === "Story" ? "Untitled Story" : "New Folder";
      try {
        const created = await vaultCreateItem(type, defaultName, getParentId());
        const refreshed = await vaultListItems();
        setItems(refreshed);
        // Trigger inline rename for the new item
        setPendingRename(created.id);
        close();
      } catch (e) {
        console.error(`Failed to create ${type}:`, e);
      }
    },
    [getParentId, setItems, setPendingRename, close],
  );

  const handleCreateSourceDoc = useCallback(async () => {
    if (!activeSubtype || !sourceDocName.trim()) return;
    try {
      await vaultCreateItem("SourceDocument", sourceDocName.trim(), getParentId(), activeSubtype);
      const refreshed = await vaultListItems();
      setItems(refreshed);
      close();
    } catch (e) {
      console.error("Failed to create source document:", e);
    }
  }, [activeSubtype, sourceDocName, getParentId, setItems, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (activeSubtype) {
          setActiveSubtype(null);
          setSourceDocName("");
        } else {
          close();
        }
      }
    },
    [activeSubtype, close],
  );

  if (!createNewOpen) return null;

  const itemButtonStyle = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "8px 12px",
    background: "none",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "var(--font-sans)",
    color: "var(--color-text-primary)",
    textAlign: "left" as const,
    transition: "background-color 150ms ease",
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 100 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="flex flex-col"
        style={{
          width: "320px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: "40px",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              letterSpacing: "0.04em",
            }}
          >
            {activeSubtype ? "Name Document" : "Create New"}
          </span>
          <button
            onClick={close}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
              padding: "4px",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col p-2">
          {activeSubtype ? (
            /* Source document name input */
            <div className="flex flex-col gap-2 p-2">
              <input
                type="text"
                value={sourceDocName}
                onChange={(e) => setSourceDocName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateSourceDoc();
                  }
                }}
                placeholder="Document name..."
                autoFocus
                style={{
                  background: "var(--color-bg-hover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  outline: "none",
                  fontSize: "13px",
                  fontFamily: "var(--font-sans)",
                  color: "var(--color-text-primary)",
                  padding: "6px 8px",
                  height: "32px",
                }}
              />
              <button
                onClick={handleCreateSourceDoc}
                disabled={!sourceDocName.trim()}
                style={{
                  backgroundColor: sourceDocName.trim()
                    ? "var(--color-accent)"
                    : "var(--color-bg-hover)",
                  color: sourceDocName.trim()
                    ? "var(--color-text-on-accent)"
                    : "var(--color-text-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  cursor: sourceDocName.trim() ? "pointer" : "default",
                  transition: "background-color 150ms ease",
                }}
              >
                Create
              </button>
            </div>
          ) : (
            <>
              {/* Story */}
              <button
                style={itemButtonStyle}
                onClick={() => handleCreateSimple("Story")}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <BookOpen size={16} style={{ color: "var(--color-text-muted)" }} />
                Story
              </button>

              {/* Folder */}
              <button
                style={itemButtonStyle}
                onClick={() => handleCreateSimple("Folder")}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Folder size={16} style={{ color: "var(--color-text-muted)" }} />
                Folder
              </button>

              {/* Separator */}
              <div
                className="flex items-center gap-2 px-3 my-1"
                style={{ color: "var(--color-text-muted)", fontSize: "11px" }}
              >
                <div
                  className="flex-1"
                  style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }}
                />
                <span style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
                  Source Documents
                </span>
                <div
                  className="flex-1"
                  style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }}
                />
              </div>

              {/* Character Profile */}
              <button
                style={itemButtonStyle}
                onClick={() => setActiveSubtype("CharacterProfile")}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <User size={16} style={{ color: "var(--color-text-muted)" }} />
                Character Profile
              </button>

              {/* World Building */}
              <button
                style={itemButtonStyle}
                onClick={() => setActiveSubtype("WorldBuilding")}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Globe size={16} style={{ color: "var(--color-text-muted)" }} />
                World Building
              </button>

              {/* Image */}
              <button
                style={itemButtonStyle}
                onClick={() => setActiveSubtype("Image")}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Image size={16} style={{ color: "var(--color-text-muted)" }} />
                Image
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
