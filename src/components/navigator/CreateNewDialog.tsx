import { useState, useCallback, useEffect } from "react";
import { X, BookOpen, Folder, FileText, Image, User, Globe } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../../stores/vaultStore";
import { vaultCreateItem, vaultCreateItemWithContent, vaultListItems, listTemplates, vaultUploadImage } from "../../lib/tauriApi";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { Template } from "../../lib/types";

// Map template icon names to lucide-react components
function getTemplateIcon(iconName: string) {
  switch (iconName) {
    case "User": return <User size={16} style={{ color: "var(--color-text-muted)" }} />;
    case "Globe": return <Globe size={16} style={{ color: "var(--color-text-muted)" }} />;
    case "Image": return <Image size={16} style={{ color: "var(--color-text-muted)" }} />;
    default: return <FileText size={16} style={{ color: "var(--color-text-muted)" }} />;
  }
}

export function CreateNewDialog() {
  const createNewOpen = useVaultStore((s) => s.createNewOpen);
  const setCreateNewOpen = useVaultStore((s) => s.setCreateNewOpen);
  const setItems = useVaultStore((s) => s.setItems);
  const setPendingRename = useVaultStore((s) => s.setPendingRename);
  const selectedItems = useVaultStore((s) => s.selectedItems);
  const items = useVaultStore((s) => s.items);

  const [sourceDocName, setSourceDocName] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);

  const dialogRef = useFocusTrap(createNewOpen);

  // Load templates when dialog opens
  useEffect(() => {
    if (createNewOpen) {
      listTemplates()
        .then(setTemplates)
        .catch((e) => console.error("Failed to load templates:", e));
    }
  }, [createNewOpen]);

  const close = useCallback(() => {
    setCreateNewOpen(false);
    setActiveTemplate(null);
    setSourceDocName("");
    setError(null);
  }, [setCreateNewOpen]);

  // Determine parent: if a folder is selected, create inside it; otherwise root
  const getParentId = useCallback((): string | null => {
    const selectedArr = Array.from(selectedItems);
    if (selectedArr.length === 1) {
      const selected = items.find((i) => i.id === selectedArr[0]);
      if (selected?.item_type === "Folder") return selected.id;
      if (selected?.parent_id) return selected.parent_id;
    }
    return null;
  }, [selectedItems, items]);

  const handleCreateSimple = useCallback(
    async (type: "Story" | "Folder") => {
      const defaultName = type === "Story" ? "Untitled Story" : "New Folder";
      setError(null);
      try {
        const created = await vaultCreateItem(type, defaultName, getParentId());
        const refreshed = await vaultListItems();
        setItems(refreshed);
        setPendingRename(created.id);
        close();
      } catch (e) {
        console.error(`Failed to create ${type}:`, e);
        setError(String(e));
      }
    },
    [getParentId, setItems, setPendingRename, close],
  );

  const handleCreateSourceDoc = useCallback(async () => {
    if (!activeTemplate || !sourceDocName.trim()) return;
    setError(null);
    try {
      const itemType = activeTemplate.slug === "image" ? "Image" : "SourceDocument";
      // Use create_with_content to populate template default_content
      await vaultCreateItemWithContent(
        itemType,
        sourceDocName.trim(),
        getParentId(),
        activeTemplate.slug,
        activeTemplate.default_content,
      );
      const refreshed = await vaultListItems();
      setItems(refreshed);
      close();
    } catch (e) {
      console.error("Failed to create source document:", e);
      setError(String(e));
    }
  }, [activeTemplate, sourceDocName, getParentId, setItems, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (activeTemplate) {
          setActiveTemplate(null);
          setSourceDocName("");
        } else {
          close();
        }
      }
    },
    [activeTemplate, close],
  );

  if (!createNewOpen) return null;

  // Separate builtin image template from user-defined templates
  const userTemplates = templates.filter((t) => !t.is_builtin);

  // If no user templates exist, show hardcoded defaults as fallback
  const hasUserTemplates = userTemplates.length > 0;

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

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.backgroundColor = "transparent";
    },
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
            {activeTemplate ? "Name Document" : "Create New"}
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
          {activeTemplate ? (
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
              <button style={itemButtonStyle} onClick={() => handleCreateSimple("Story")} {...hoverHandlers}>
                <BookOpen size={16} style={{ color: "var(--color-text-muted)" }} />
                Story
              </button>

              {/* Folder */}
              <button style={itemButtonStyle} onClick={() => handleCreateSimple("Folder")} {...hoverHandlers}>
                <Folder size={16} style={{ color: "var(--color-text-muted)" }} />
                Folder
              </button>

              {/* Separator */}
              <div
                className="flex items-center gap-2 px-3 my-1"
                style={{ color: "var(--color-text-muted)", fontSize: "11px" }}
              >
                <div className="flex-1" style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }} />
                <span style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
                  Source Documents
                </span>
                <div className="flex-1" style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }} />
              </div>

              {/* User-defined templates from DB */}
              {hasUserTemplates ? (
                userTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    style={itemButtonStyle}
                    onClick={() => setActiveTemplate(tmpl)}
                    {...hoverHandlers}
                  >
                    {getTemplateIcon(tmpl.icon)}
                    {tmpl.name}
                  </button>
                ))
              ) : (
                <>
                  {/* Hardcoded defaults when no user templates exist */}
                  <button
                    style={itemButtonStyle}
                    onClick={() => setActiveTemplate({
                      id: "__char__", slug: "character_profile", name: "Character Profile",
                      icon: "User", default_content: "## {{character_name}}\n\n**Age:** {{age}}\n**Occupation:** {{occupation}}\n\n### Backstory\n{{backstory}}\n\n### Personality\n{{personality}}\n\n### Notes\n{{notes}}",
                      is_builtin: false, created_at: "", modified_at: "",
                    })}
                    {...hoverHandlers}
                  >
                    <User size={16} style={{ color: "var(--color-text-muted)" }} />
                    Character Profile
                  </button>
                  <button
                    style={itemButtonStyle}
                    onClick={() => setActiveTemplate({
                      id: "__world__", slug: "world_building", name: "World Building",
                      icon: "Globe", default_content: "## {{location_name}}\n\n### Description\n{{description}}\n\n### History\n{{history}}\n\n### Notable Features\n{{features}}\n\n### Notes\n{{notes}}",
                      is_builtin: false, created_at: "", modified_at: "",
                    })}
                    {...hoverHandlers}
                  >
                    <Globe size={16} style={{ color: "var(--color-text-muted)" }} />
                    World Building
                  </button>
                </>
              )}

              {/* Image — opens native file picker */}
              <button
                style={itemButtonStyle}
                onClick={async () => {
                  setError(null);
                  try {
                    const selected = await open({
                      multiple: false,
                      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
                    });
                    if (!selected) return;
                    const filePath = typeof selected === "string" ? selected : selected;
                    // Extract filename without extension for the item name
                    const segments = filePath.replace(/\\/g, "/").split("/");
                    const fileName = segments[segments.length - 1]?.replace(/\.[^.]+$/, "") || "Untitled Image";
                    await vaultUploadImage(filePath, fileName, getParentId());
                    const refreshed = await vaultListItems();
                    setItems(refreshed);
                    close();
                  } catch (e) {
                    console.error("Failed to upload image:", e);
                    setError(String(e));
                  }
                }}
                {...hoverHandlers}
              >
                <Image size={16} style={{ color: "var(--color-text-muted)" }} />
                Image
              </button>
            </>
          )}

          {error && (
            <p
              style={{
                fontSize: "12px",
                color: "var(--color-error)",
                padding: "4px 12px 4px",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
