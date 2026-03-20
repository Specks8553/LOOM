import { useState, useEffect, useCallback } from "react";
import { X, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useVaultStore } from "../../stores/vaultStore";
import {
  syncAccentToWorldMeta,
  resetRateLimiter,
  validateAndStoreApiKey,
  saveApiKeyToDb,
  renameWorld,
  hasApiKey,
  listTemplates,
  saveTemplateCmd,
  deleteTemplateCmd,
} from "../../lib/tauriApi";
import type { Template } from "../../lib/types";
import {
  applyAccentColor,
  applyBodyFont,
  applyBubbleColors,
  applyFeatureColors,
} from "../../lib/applyTheme";

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabId =
  | "general"
  | "connections"
  | "security"
  | "export"
  | "appearance"
  | "writing"
  | "templates"
  | "developer";

interface TabDef {
  id: TabId;
  label: string;
  section: "APP SETTINGS" | "WORLD SETTINGS" | "DEV SETTINGS";
}

const TABS: TabDef[] = [
  { id: "general", label: "General", section: "APP SETTINGS" },
  { id: "connections", label: "Connections", section: "APP SETTINGS" },
  { id: "security", label: "Security", section: "APP SETTINGS" },
  { id: "export", label: "Export", section: "APP SETTINGS" },
  { id: "appearance", label: "Appearance", section: "WORLD SETTINGS" },
  { id: "writing", label: "Writing", section: "WORLD SETTINGS" },
  { id: "templates", label: "Templates", section: "WORLD SETTINGS" },
  { id: "developer", label: "Developer", section: "DEV SETTINGS" },
];

// ─── Main Modal ──────────────────────────────────────────────────────────────

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [activeTab, setActiveTab] = useState<TabId>("general");

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, setOpen]);

  if (!open) return null;

  // Group tabs by section
  const sections = new Map<string, TabDef[]>();
  for (const tab of TABS) {
    const list = sections.get(tab.section) ?? [];
    list.push(tab);
    sections.set(tab.section, list);
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 200 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="flex"
        style={{
          width: "780px",
          height: "80vh",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        {/* Left sidebar — tab navigation */}
        <div
          className="flex flex-col shrink-0"
          style={{
            width: "180px",
            backgroundColor: "var(--color-bg-pane)",
            borderRight: "1px solid var(--color-border)",
            padding: "16px 0",
            overflowY: "auto",
          }}
        >
          {/* Modal title */}
          <div
            style={{
              padding: "0 16px 12px",
              fontSize: "16px",
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
            }}
          >
            Settings
          </div>

          {Array.from(sections.entries()).map(([section, tabs]) => (
            <div key={section}>
              {/* Section header */}
              <div
                style={{
                  padding: "12px 16px 4px",
                  fontSize: "10px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-text-muted)",
                }}
              >
                {section}
              </div>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 16px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontFamily: "var(--font-sans)",
                    borderRadius: "0",
                    backgroundColor:
                      activeTab === tab.id
                        ? "var(--color-bg-active)"
                        : "transparent",
                    color:
                      activeTab === tab.id
                        ? "var(--color-text-primary)"
                        : "var(--color-text-secondary)",
                  }}
                  onMouseEnter={(e) => {
                    if (activeTab !== tab.id)
                      e.currentTarget.style.backgroundColor =
                        "var(--color-bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== tab.id)
                      e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right content area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Header with close button */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-primary)",
              }}
            >
              {TABS.find((t) => t.id === activeTab)?.label}
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                padding: "4px",
                borderRadius: "4px",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--color-text-primary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--color-text-muted)")
              }
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable tab content */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ padding: "16px 20px" }}
          >
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "writing" && <WritingTab />}
            {activeTab === "connections" && <ConnectionsTab />}
            {activeTab === "security" && <SecurityTab />}
            {activeTab === "export" && <ExportTab />}
            {activeTab === "templates" && <TemplatesTab />}
            {activeTab === "developer" && <DeveloperTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

/** Auto-save field wrapper: flashes check on save */
function SettingField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label
        style={{
          display: "block",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: "4px",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Confirmation flash for saved settings */
function useSaveFlash() {
  const [flash, setFlash] = useState(false);
  const trigger = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  }, []);
  return { flash, trigger };
}

function SaveFlash({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Check
      size={14}
      style={{
        color: "var(--color-success)",
        marginLeft: "6px",
        display: "inline",
      }}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg-base)",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  padding: "6px 10px",
  fontSize: "13px",
  fontFamily: "var(--font-sans)",
  color: "var(--color-text-primary)",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: "80px",
  resize: "vertical",
  lineHeight: 1.5,
};

// ─── Tab: General ─────────────────────────────────────────────────────────────

function GeneralTab() {
  const worlds = useVaultStore((s) => s.worlds);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const currentWorld = worlds.find((w) => w.id === activeWorldId);

  const [worldName, setWorldName] = useState(currentWorld?.name ?? "");
  const [autoLock, setAutoLock] = useState(
    localStorage.getItem("loom_auto_lock_minutes") ?? "15",
  );
  const worldNameFlash = useSaveFlash();
  const autoLockFlash = useSaveFlash();

  const handleWorldNameBlur = useCallback(async () => {
    if (!activeWorldId || worldName.trim() === "") return;
    try {
      await renameWorld(activeWorldId, worldName.trim());
      worldNameFlash.trigger();
    } catch (e) {
      toast.error(`Failed to rename world: ${e}`);
    }
  }, [activeWorldId, worldName, worldNameFlash]);

  const handleAutoLockChange = useCallback(
    (value: string) => {
      setAutoLock(value);
      localStorage.setItem("loom_auto_lock_minutes", value);
      autoLockFlash.trigger();
    },
    [autoLockFlash],
  );

  return (
    <>
      <SettingField label="Auto-lock timer">
        <div className="flex items-center">
          <select
            value={autoLock}
            onChange={(e) => handleAutoLockChange(e.target.value)}
            style={selectStyle}
          >
            <option value="0">Off</option>
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
          <SaveFlash visible={autoLockFlash.flash} />
        </div>
      </SettingField>

      <SettingField label="World name">
        <div className="flex items-center">
          <input
            type="text"
            value={worldName}
            onChange={(e) => setWorldName(e.target.value)}
            onBlur={handleWorldNameBlur}
            style={inputStyle}
          />
          <SaveFlash visible={worldNameFlash.flash} />
        </div>
      </SettingField>

      <SaveApplyButton onClick={async () => {
        await handleWorldNameBlur();
        handleAutoLockChange(autoLock);
      }} />
    </>
  );
}

// ─── Tab: Appearance ──────────────────────────────────────────────────────────

function AppearanceTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [accentColor, setAccentColor] = useState(
    settings.accent_color ?? "#7c3aed",
  );
  const [bodyFont, setBodyFont] = useState(settings.body_font ?? "serif");
  const [bubbleUser, setBubbleUser] = useState(
    settings.bubble_user_color ?? "",
  );
  const [bubbleAi, setBubbleAi] = useState(
    settings.bubble_ai_color ?? "#1a1a1a",
  );
  const [gwFrame, setGwFrame] = useState(
    settings.ghostwriter_frame_color ?? "",
  );
  const [gwDiff, setGwDiff] = useState(settings.ghostwriter_diff_color ?? "");
  const [cpColor, setCpColor] = useState(settings.checkpoint_color ?? "");
  const [accColor, setAccColor] = useState(settings.accordion_color ?? "");

  const accentFlash = useSaveFlash();
  const fontFlash = useSaveFlash();
  const bubbleFlash = useSaveFlash();
  const featureFlash = useSaveFlash();

  const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  // Accent color: apply live on valid input, save on blur
  const handleAccentChange = useCallback(
    (val: string) => {
      setAccentColor(val);
      if (isValidHex(val)) applyAccentColor(val);
    },
    [],
  );

  const handleAccentBlur = useCallback(async () => {
    if (!isValidHex(accentColor)) return;
    await updateSetting("accent_color", accentColor);
    await syncAccentToWorldMeta(accentColor);
    accentFlash.trigger();
  }, [accentColor, updateSetting, accentFlash]);

  const handleFontChange = useCallback(
    async (val: string) => {
      setBodyFont(val);
      applyBodyFont(val as "serif" | "sans" | "mono");
      await updateSetting("body_font", val);
      fontFlash.trigger();
    },
    [updateSetting, fontFlash],
  );

  const handleBubbleBlur = useCallback(async () => {
    applyBubbleColors(bubbleUser || null, bubbleAi || "#1a1a1a");
    await updateSetting("bubble_user_color", bubbleUser);
    await updateSetting("bubble_ai_color", bubbleAi);
    bubbleFlash.trigger();
  }, [bubbleUser, bubbleAi, updateSetting, bubbleFlash]);

  const handleFeatureBlur = useCallback(async () => {
    applyFeatureColors({
      ghostwriterFrame: gwFrame || null,
      ghostwriterDiff: gwDiff || null,
      checkpoint: cpColor || null,
      accordion: accColor || null,
    });
    await updateSetting("ghostwriter_frame_color", gwFrame);
    await updateSetting("ghostwriter_diff_color", gwDiff);
    await updateSetting("checkpoint_color", cpColor);
    await updateSetting("accordion_color", accColor);
    featureFlash.trigger();
  }, [gwFrame, gwDiff, cpColor, accColor, updateSetting, featureFlash]);

  return (
    <>
      {/* Accent color */}
      <SettingField label="Accent color">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={accentColor}
            onChange={(e) => handleAccentChange(e.target.value)}
            onBlur={handleAccentBlur}
            placeholder="#7c3aed"
            style={{ ...inputStyle, width: "140px" }}
          />
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              backgroundColor: isValidHex(accentColor)
                ? accentColor
                : "#7c3aed",
              border: "1px solid var(--color-border)",
              flexShrink: 0,
            }}
          />
          <SaveFlash visible={accentFlash.flash} />
        </div>
      </SettingField>

      {/* Body font */}
      <SettingField label="Theater body font">
        <div className="flex items-center">
          <select
            value={bodyFont}
            onChange={(e) => handleFontChange(e.target.value)}
            style={selectStyle}
          >
            <option value="serif">Lora (Serif)</option>
            <option value="sans">Inter (Sans-serif)</option>
            <option value="mono">JetBrains Mono (Monospace)</option>
          </select>
          <SaveFlash visible={fontFlash.flash} />
        </div>
      </SettingField>

      {/* Bubble colors */}
      <SectionHeader>Message Bubble Colors</SectionHeader>
      <SettingField label="Your messages (empty = track accent)">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={bubbleUser}
            onChange={(e) => setBubbleUser(e.target.value)}
            onBlur={handleBubbleBlur}
            placeholder="Track accent color"
            style={{ ...inputStyle, width: "180px" }}
          />
          {isValidHex(bubbleUser) && (
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "4px",
                backgroundColor: bubbleUser,
                border: "1px solid var(--color-border)",
              }}
            />
          )}
          <SaveFlash visible={bubbleFlash.flash} />
        </div>
      </SettingField>
      <SettingField label="AI messages">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={bubbleAi}
            onChange={(e) => setBubbleAi(e.target.value)}
            onBlur={handleBubbleBlur}
            placeholder="#1a1a1a"
            style={{ ...inputStyle, width: "180px" }}
          />
          {isValidHex(bubbleAi) && (
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "4px",
                backgroundColor: bubbleAi,
                border: "1px solid var(--color-border)",
              }}
            />
          )}
        </div>
      </SettingField>

      {/* Feature colors */}
      <SectionHeader>Feature Colors (empty = track accent)</SectionHeader>
      <div className="grid grid-cols-2 gap-x-4">
        <SettingField label="Ghostwriter frame">
          <input
            type="text"
            value={gwFrame}
            onChange={(e) => setGwFrame(e.target.value)}
            onBlur={handleFeatureBlur}
            placeholder="Track accent"
            style={{ ...inputStyle, width: "140px" }}
          />
        </SettingField>
        <SettingField label="Ghostwriter diff">
          <input
            type="text"
            value={gwDiff}
            onChange={(e) => setGwDiff(e.target.value)}
            onBlur={handleFeatureBlur}
            placeholder="Track accent"
            style={{ ...inputStyle, width: "140px" }}
          />
        </SettingField>
        <SettingField label="Checkpoint marker">
          <input
            type="text"
            value={cpColor}
            onChange={(e) => setCpColor(e.target.value)}
            onBlur={handleFeatureBlur}
            placeholder="Track accent"
            style={{ ...inputStyle, width: "140px" }}
          />
        </SettingField>
        <SettingField label="Accordion segment">
          <div className="flex items-center">
            <input
              type="text"
              value={accColor}
              onChange={(e) => setAccColor(e.target.value)}
              onBlur={handleFeatureBlur}
              placeholder="Track accent"
              style={{ ...inputStyle, width: "140px" }}
            />
            <SaveFlash visible={featureFlash.flash} />
          </div>
        </SettingField>
      </div>

      <SaveApplyButton onClick={async () => {
        await handleAccentBlur();
        await handleBubbleBlur();
        await handleFeatureBlur();
      }} />
    </>
  );
}

// ─── Tab: Writing ─────────────────────────────────────────────────────────────

function WritingTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [sysInstr, setSysInstr] = useState(
    settings.system_instructions ?? "",
  );
  const [modPresets, setModPresets] = useState(
    settings.modificator_presets ?? "[]",
  );
  const sysFlash = useSaveFlash();
  const modFlash = useSaveFlash();

  const handleSysBlur = useCallback(async () => {
    await updateSetting("system_instructions", sysInstr);
    sysFlash.trigger();
  }, [sysInstr, updateSetting, sysFlash]);

  // Parse mod presets for display
  let presets: { name: string; tags: string[] }[] = [];
  try {
    presets = JSON.parse(modPresets);
  } catch {
    /* ignore */
  }

  const [newPresetTags, setNewPresetTags] = useState("");

  const handleAddPreset = useCallback(async () => {
    if (!newPresetTags.trim()) return;
    const tags = newPresetTags
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
    if (tags.length === 0) return;
    const name = tags.slice(0, 3).join(", ");
    const updated = [...presets, { name, tags }];
    if (updated.length > 5) {
      toast.error("Maximum 5 presets");
      return;
    }
    const json = JSON.stringify(updated);
    setModPresets(json);
    await updateSetting("modificator_presets", json);
    setNewPresetTags("");
    modFlash.trigger();
  }, [newPresetTags, presets, updateSetting, modFlash]);

  const handleDeletePreset = useCallback(
    async (idx: number) => {
      const updated = presets.filter((_, i) => i !== idx);
      const json = JSON.stringify(updated);
      setModPresets(json);
      await updateSetting("modificator_presets", json);
      modFlash.trigger();
    },
    [presets, updateSetting, modFlash],
  );

  return (
    <>
      <SettingField label="System instructions">
        <div className="flex items-start">
          <textarea
            value={sysInstr}
            onChange={(e) => setSysInstr(e.target.value)}
            onBlur={handleSysBlur}
            placeholder="Custom system instructions for AI..."
            style={{ ...textareaStyle, minHeight: "120px" }}
          />
          <SaveFlash visible={sysFlash.flash} />
        </div>
      </SettingField>

      <SectionHeader>Modificator Presets</SectionHeader>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: "8px" }}>
        {presets.map((p, i) => (
          <span
            key={i}
            className="flex items-center gap-1"
            style={{
              background: "rgba(124,58,237,0.12)",
              border: "1px solid rgba(124,58,237,0.25)",
              borderRadius: "12px",
              padding: "3px 8px",
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-accent-text)",
            }}
          >
            {p.name}
            <button
              onClick={() => handleDeletePreset(i)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                fontSize: "14px",
                padding: "0 2px",
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          </span>
        ))}
        <SaveFlash visible={modFlash.flash} />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newPresetTags}
          onChange={(e) => setNewPresetTags(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddPreset();
          }}
          placeholder="Tags (comma-separated)..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={handleAddPreset}
          disabled={!newPresetTags.trim()}
          style={{
            background: newPresetTags.trim()
              ? "var(--color-accent)"
              : "var(--color-bg-active)",
            border: "none",
            borderRadius: "6px",
            padding: "6px 12px",
            cursor: newPresetTags.trim() ? "pointer" : "not-allowed",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: newPresetTags.trim() ? "#fff" : "var(--color-text-muted)",
          }}
        >
          Add
        </button>
      </div>

      <SaveApplyButton onClick={async () => {
        await handleSysBlur();
      }} />
    </>
  );
}

// ─── Tab: Connections ─────────────────────────────────────────────────────────

function ConnectionsTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [modelName, setModelName] = useState(
    settings.text_model_name ?? "gemini-2.5-flash",
  );
  const modelFlash = useSaveFlash();

  // Parse model options
  let modelOptions: string[] = [];
  try {
    modelOptions = JSON.parse(
      settings.text_model_options ??
        '["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"]',
    );
  } catch {
    modelOptions = ["gemini-2.5-flash"];
  }

  const handleModelChange = useCallback(
    async (val: string) => {
      setModelName(val);
      await updateSetting("text_model_name", val);
      modelFlash.trigger();
    },
    [updateSetting, modelFlash],
  );

  // API key state
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [keyLoading, setKeyLoading] = useState(false);

  useEffect(() => {
    hasApiKey().then(setApiKeyPresent).catch(() => setApiKeyPresent(false));
  }, []);

  const handleSaveKey = useCallback(async () => {
    if (!newKey.trim()) return;
    setKeyLoading(true);
    try {
      await validateAndStoreApiKey(newKey.trim());
      await saveApiKeyToDb();
      setApiKeyPresent(true);
      setShowKeyInput(false);
      setNewKey("");
      toast.success("API key saved");
    } catch (e) {
      toast.error(`Failed to save API key: ${e}`);
    } finally {
      setKeyLoading(false);
    }
  }, [newKey]);

  return (
    <>
      <SectionHeader>Text Generation</SectionHeader>

      <SettingField label="Model">
        <div className="flex items-center">
          <select
            value={modelName}
            onChange={(e) => handleModelChange(e.target.value)}
            style={selectStyle}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <SaveFlash visible={modelFlash.flash} />
        </div>
      </SettingField>

      <SettingField label="API Key">
        {apiKeyPresent && !showKeyInput ? (
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
              }}
            >
              &bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;
            </span>
            <button
              onClick={() => setShowKeyInput(true)}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "3px 10px",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-secondary)",
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Enter Gemini API key..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleSaveKey}
              disabled={keyLoading || !newKey.trim()}
              style={{
                background: newKey.trim()
                  ? "var(--color-accent)"
                  : "var(--color-bg-active)",
                border: "none",
                borderRadius: "6px",
                padding: "6px 12px",
                cursor: newKey.trim() ? "pointer" : "not-allowed",
                fontSize: "12px",
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                color: newKey.trim() ? "#fff" : "var(--color-text-muted)",
              }}
            >
              {keyLoading ? "Saving..." : "Save"}
            </button>
            {showKeyInput && (
              <button
                onClick={() => {
                  setShowKeyInput(false);
                  setNewKey("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </SettingField>

      {/* Image Gen & TTS — greyed out */}
      <SectionHeader>Image Generation</SectionHeader>
      <p
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          opacity: 0.4,
          fontStyle: "italic",
        }}
      >
        Not yet available
      </p>

      <SectionHeader>Text-to-Speech</SectionHeader>
      <p
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          opacity: 0.4,
          fontStyle: "italic",
        }}
      >
        Not yet available
      </p>

      <SaveApplyButton onClick={async () => {
        await handleModelChange(modelName);
      }} />
    </>
  );
}

// ─── Tab: Security ────────────────────────────────────────────────────────────

function SecurityTab() {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [changingPwd, setChangingPwd] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (!currentPwd) {
      toast.error("Enter your current password");
      return;
    }
    if (newPwd.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPwd(true);
    try {
      const { changeMasterPassword } = await import("../../lib/tauriApi");
      await changeMasterPassword(currentPwd, newPwd);
      toast.success("Master password changed successfully");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      toast.error(`Password change failed: ${e}`);
    } finally {
      setChangingPwd(false);
    }
  }, [currentPwd, newPwd, confirmPwd]);

  return (
    <>
      <SectionHeader>Change Master Password</SectionHeader>

      <SettingField label="Current password">
        <div className="flex items-center gap-1">
          <input
            type={showCurrent ? "text" : "password"}
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => setShowCurrent(!showCurrent)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: "4px",
            }}
          >
            {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </SettingField>

      <SettingField label="New password">
        <div className="flex items-center gap-1">
          <input
            type={showNew ? "text" : "password"}
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => setShowNew(!showNew)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: "4px",
            }}
          >
            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </SettingField>

      <SettingField label="Confirm new password">
        <input
          type="password"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          style={inputStyle}
        />
      </SettingField>

      <button
        onClick={handleChangePassword}
        disabled={!currentPwd || !newPwd || !confirmPwd || changingPwd}
        style={{
          background:
            currentPwd && newPwd && confirmPwd && !changingPwd
              ? "var(--color-accent)"
              : "var(--color-bg-active)",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor:
            currentPwd && newPwd && confirmPwd && !changingPwd ? "pointer" : "not-allowed",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          color:
            currentPwd && newPwd && confirmPwd && !changingPwd
              ? "#fff"
              : "var(--color-text-muted)",
        }}
      >
        {changingPwd ? "Changing..." : "Change Password"}
      </button>
    </>
  );
}

// ─── Tab: Export ──────────────────────────────────────────────────────────────

function ExportTab() {
  const [exportPath, setExportPath] = useState(
    localStorage.getItem("loom_export_folder_path") ?? "",
  );
  const pathFlash = useSaveFlash();

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true });
      if (selected && typeof selected === "string") {
        setExportPath(selected);
        localStorage.setItem("loom_export_folder_path", selected);
        pathFlash.trigger();
      }
    } catch (e) {
      toast.error(`Failed to pick folder: ${e}`);
    }
  }, [pathFlash]);

  return (
    <>
      <SettingField label="Export folder">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={exportPath}
            readOnly
            placeholder="No folder selected"
            style={{ ...inputStyle, flex: 1, cursor: "default" }}
          />
          <button
            onClick={handleBrowse}
            style={{
              background: "var(--color-bg-active)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            Browse
          </button>
          <SaveFlash visible={pathFlash.flash} />
        </div>
        <p
          style={{
            fontSize: "11px",
            color: "var(--color-text-muted)",
            marginTop: "4px",
          }}
        >
          Exported Markdown files are saved here automatically.
        </p>
      </SettingField>

      <SaveApplyButton onClick={() => {
        localStorage.setItem("loom_export_folder_path", exportPath);
        pathFlash.trigger();
      }} />
    </>
  );
}

// ─── Tab: Developer ──────────────────────────────────────────────────────────

function DeveloperTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const [rpm, setRpm] = useState(settings.rate_limit_rpm ?? "10");
  const [tpm, setTpm] = useState(settings.rate_limit_tpm ?? "250000");
  const [rpd, setRpd] = useState(settings.rate_limit_rpd ?? "1500");
  const [ctxLimit, setCtxLimit] = useState(
    settings.context_token_limit ?? "128000",
  );
  const [customModel, setCustomModel] = useState("");

  const rateFlash = useSaveFlash();
  const ctxFlash = useSaveFlash();
  const modelFlash = useSaveFlash();

  // Parse current model options
  let modelOptions: string[] = [];
  try {
    modelOptions = JSON.parse(
      settings.text_model_options ??
        '["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"]',
    );
  } catch {
    modelOptions = [];
  }

  const builtinModels = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
  const customModels = modelOptions.filter((m) => !builtinModels.includes(m));

  const handleRateBlur = useCallback(
    async (key: string, value: string) => {
      await updateSetting(key, value);
      rateFlash.trigger();
    },
    [updateSetting, rateFlash],
  );

  const handleCtxBlur = useCallback(async () => {
    await updateSetting("context_token_limit", ctxLimit);
    ctxFlash.trigger();
  }, [ctxLimit, updateSetting, ctxFlash]);

  const handleAddModel = useCallback(async () => {
    const name = customModel.trim();
    if (!name || modelOptions.includes(name)) return;
    if (modelOptions.length >= 10) {
      toast.error("Maximum 10 models");
      return;
    }
    const updated = [...modelOptions, name];
    await updateSetting("text_model_options", JSON.stringify(updated));
    setCustomModel("");
    modelFlash.trigger();
  }, [customModel, modelOptions, updateSetting, modelFlash]);

  const handleRemoveModel = useCallback(
    async (name: string) => {
      const updated = modelOptions.filter((m) => m !== name);
      await updateSetting("text_model_options", JSON.stringify(updated));
      // If the active model was removed, switch to default
      if (settings.text_model_name === name) {
        await updateSetting("text_model_name", "gemini-2.5-flash");
      }
      modelFlash.trigger();
    },
    [modelOptions, settings.text_model_name, updateSetting, modelFlash],
  );

  const handleResetRateLimiter = useCallback(async () => {
    try {
      await resetRateLimiter();
      toast.success("Rate limit counters reset");
    } catch (e) {
      toast.error(`Reset failed: ${e}`);
    }
  }, []);

  // Prompt templates
  const [promptGw, setPromptGw] = useState(
    settings.prompt_ghostwriter ?? "",
  );
  const [promptAccSum, setPromptAccSum] = useState(
    settings.prompt_accordion_summarise ?? "",
  );
  const [promptAccUser, setPromptAccUser] = useState(
    settings.prompt_accordion_fake_user ?? "",
  );
  const promptFlash = useSaveFlash();

  const handlePromptBlur = useCallback(
    async (key: string, value: string) => {
      await updateSetting(key, value);
      promptFlash.trigger();
    },
    [updateSetting, promptFlash],
  );

  return (
    <>
      {/* Rate Limits */}
      <SectionHeader>Rate Limits</SectionHeader>
      <div className="grid grid-cols-3 gap-3">
        <SettingField label="RPM (requests/min)">
          <input
            type="number"
            value={rpm}
            onChange={(e) => setRpm(e.target.value)}
            onBlur={() => handleRateBlur("rate_limit_rpm", rpm)}
            style={inputStyle}
          />
        </SettingField>
        <SettingField label="TPM (tokens/min)">
          <input
            type="number"
            value={tpm}
            onChange={(e) => setTpm(e.target.value)}
            onBlur={() => handleRateBlur("rate_limit_tpm", tpm)}
            style={inputStyle}
          />
        </SettingField>
        <SettingField label="RPD (requests/day)">
          <div className="flex items-center">
            <input
              type="number"
              value={rpd}
              onChange={(e) => setRpd(e.target.value)}
              onBlur={() => handleRateBlur("rate_limit_rpd", rpd)}
              style={inputStyle}
            />
            <SaveFlash visible={rateFlash.flash} />
          </div>
        </SettingField>
      </div>

      <button
        onClick={handleResetRateLimiter}
        style={{
          background: "none",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "6px 12px",
          cursor: "pointer",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-secondary)",
          marginBottom: "16px",
        }}
      >
        Reset Rate Limit Counters
      </button>

      {/* Context token limit */}
      <SettingField label="Context token limit">
        <div className="flex items-center">
          <input
            type="number"
            value={ctxLimit}
            onChange={(e) => setCtxLimit(e.target.value)}
            onBlur={handleCtxBlur}
            style={{ ...inputStyle, width: "160px" }}
          />
          <SaveFlash visible={ctxFlash.flash} />
        </div>
      </SettingField>

      {/* Custom Models */}
      <SectionHeader>Custom Models</SectionHeader>
      {customModels.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          style={{ marginBottom: "8px" }}
        >
          {customModels.map((m) => (
            <span
              key={m}
              className="flex items-center gap-1"
              style={{
                background: "var(--color-bg-active)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                padding: "3px 8px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-secondary)",
              }}
            >
              {m}
              <button
                onClick={() => handleRemoveModel(m)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "14px",
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </span>
          ))}
          <SaveFlash visible={modelFlash.flash} />
        </div>
      )}
      <div className="flex items-center gap-2" style={{ marginBottom: "16px" }}>
        <input
          type="text"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddModel();
          }}
          placeholder="Model name..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={handleAddModel}
          disabled={!customModel.trim()}
          style={{
            background: customModel.trim()
              ? "var(--color-accent)"
              : "var(--color-bg-active)",
            border: "none",
            borderRadius: "6px",
            padding: "6px 12px",
            cursor: customModel.trim() ? "pointer" : "not-allowed",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: customModel.trim() ? "#fff" : "var(--color-text-muted)",
          }}
        >
          + Add
        </button>
      </div>

      {/* AI Prompt Templates */}
      <SectionHeader>AI Prompt Templates</SectionHeader>
      <SettingField label="Ghostwriter System Instruction">
        <div className="flex items-start">
          <textarea
            value={promptGw}
            onChange={(e) => setPromptGw(e.target.value)}
            onBlur={() =>
              handlePromptBlur("prompt_ghostwriter", promptGw)
            }
            style={{
              ...textareaStyle,
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              minHeight: "100px",
            }}
          />
          <SaveFlash visible={promptFlash.flash} />
        </div>
      </SettingField>
      <SettingField label="Accordion Summarisation Instruction">
        <textarea
          value={promptAccSum}
          onChange={(e) => setPromptAccSum(e.target.value)}
          onBlur={() =>
            handlePromptBlur("prompt_accordion_summarise", promptAccSum)
          }
          style={{
            ...textareaStyle,
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            minHeight: "100px",
          }}
        />
      </SettingField>
      <SettingField label="Accordion Fake-Pair User Prompt">
        <textarea
          value={promptAccUser}
          onChange={(e) => setPromptAccUser(e.target.value)}
          onBlur={() =>
            handlePromptBlur("prompt_accordion_fake_user", promptAccUser)
          }
          style={{
            ...textareaStyle,
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
          }}
        />
      </SettingField>

      <SaveApplyButton onClick={async () => {
        await handleRateBlur("rate_limit_rpm", rpm);
        await handleRateBlur("rate_limit_tpm", tpm);
        await handleRateBlur("rate_limit_rpd", rpd);
        await handleCtxBlur();
        await handlePromptBlur("prompt_ghostwriter", promptGw);
        await handlePromptBlur("prompt_accordion_summarise", promptAccSum);
        await handlePromptBlur("prompt_accordion_fake_user", promptAccUser);
      }} />
    </>
  );
}

// ─── Small Helpers ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "11px",
        fontFamily: "var(--font-sans)",
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
        marginTop: "16px",
        marginBottom: "8px",
      }}
    >
      {children}
    </div>
  );
}

function SaveApplyButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { flash, trigger } = useSaveFlash();
  const handleClick = useCallback(() => {
    onClick();
    trigger();
  }, [onClick, trigger]);

  return (
    <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--color-border-subtle)" }}>
      <div className="flex items-center gap-2">
        <button
          onClick={handleClick}
          style={{
            background: "var(--color-accent)",
            border: "none",
            borderRadius: "6px",
            padding: "8px 20px",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: "#fff",
          }}
        >
          {label ?? "Save & Apply"}
        </button>
        <SaveFlash visible={flash} />
      </div>
    </div>
  );
}

// ─── Templates Tab (Phase 11 — Doc 08 §6.5) ─────────────────────────────────

const ICON_OPTIONS = ["FileText", "User", "Globe", "BookOpen", "Map", "Scroll", "Landmark", "Swords"];

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [isNew, setIsNew] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await listTemplates();
      // Show all templates except the Image built-in (has no editable content)
      setTemplates(list.filter((t) => !(t.is_builtin && t.slug === "image")));
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleNew = useCallback(() => {
    setEditing({
      id: crypto.randomUUID(),
      slug: "",
      name: "",
      icon: "FileText",
      default_content: "",
      is_builtin: false,
      created_at: "",
      modified_at: "",
    });
    setIsNew(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing || !editing.name.trim()) return;
    // Auto-generate slug if empty
    const slug = editing.slug.trim() || editing.name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    try {
      await saveTemplateCmd({ ...editing, slug });
      setEditing(null);
      setIsNew(false);
      await loadTemplates();
      toast.success(`Template "${editing.name}" saved`);
    } catch (e) {
      console.error("Failed to save template:", e);
      toast.error(String(e));
    }
  }, [editing, loadTemplates]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    try {
      await deleteTemplateCmd(id);
      await loadTemplates();
      setEditing(null);
      toast.success(`Template "${name}" deleted`);
    } catch (e) {
      console.error("Failed to delete template:", e);
      toast.error(String(e));
    }
  }, [loadTemplates]);

  if (editing) {
    const isBuiltin = editing.is_builtin;
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader>{isNew ? "New Template" : isBuiltin ? `Edit Built-in: ${editing.name}` : "Edit Template"}</SectionHeader>

        {/* Name — disabled for built-in */}
        <div className="flex flex-col gap-1">
          <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Name</label>
          <input
            type="text"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="e.g. Character Profile"
            autoFocus={!isBuiltin}
            disabled={isBuiltin}
            style={{
              background: "var(--color-bg-hover)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "6px 8px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: isBuiltin ? "var(--color-text-muted)" : "var(--color-text-primary)",
              outline: "none",
              opacity: isBuiltin ? 0.6 : 1,
            }}
          />
        </div>

        {/* Slug — disabled for built-in */}
        {!isBuiltin && (
          <div className="flex flex-col gap-1">
            <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              Slug <span style={{ color: "var(--color-text-muted)" }}>(auto-generated if empty)</span>
            </label>
            <input
              type="text"
              value={editing.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              placeholder="character_profile"
              style={{
                background: "var(--color-bg-hover)",
                border: "1px solid var(--color-border)",
                borderRadius: "4px",
                padding: "6px 8px",
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Icon — disabled for built-in */}
        {!isBuiltin && (
          <div className="flex flex-col gap-1">
            <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Icon</label>
            <div className="flex gap-1 flex-wrap">
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  onClick={() => setEditing({ ...editing, icon })}
                  style={{
                    padding: "4px 10px",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    borderRadius: "4px",
                    border: editing.icon === icon ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                    backgroundColor: editing.icon === icon ? "var(--color-accent-subtle)" : "transparent",
                    color: editing.icon === icon ? "var(--color-accent-text)" : "var(--color-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Default Content */}
        <div className="flex flex-col gap-1">
          <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            Default Content <span style={{ color: "var(--color-text-muted)" }}>
              (use {"{{placeholder}}"} for tab-stops)
            </span>
          </label>
          <textarea
            value={editing.default_content}
            onChange={(e) => setEditing({ ...editing, default_content: e.target.value })}
            placeholder={"## {{name}}\n\n**Age:** {{age}}\n\n### Backstory\n{{backstory}}"}
            rows={10}
            style={{
              background: "var(--color-bg-hover)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "8px",
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-primary)",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => { setEditing(null); setIsNew(false); }}
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
          {!isNew && !isBuiltin && (
            <button
              onClick={() => handleDelete(editing.id, editing.name)}
              style={{
                background: "transparent",
                border: "1px solid var(--color-border)",
                padding: "6px 14px",
                fontSize: "13px",
                color: "var(--color-error, #f87171)",
                cursor: "pointer",
                borderRadius: "6px",
              }}
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!editing.name.trim()}
            style={{
              backgroundColor: editing.name.trim() ? "var(--color-accent)" : "var(--color-bg-hover)",
              color: editing.name.trim() ? "var(--color-text-on-accent)" : "var(--color-text-muted)",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: editing.name.trim() ? "pointer" : "default",
            }}
          >
            Save Template
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader>Source Document Templates</SectionHeader>
      <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5, margin: 0 }}>
        Templates define custom Source Document types. Each template has a name, icon, and default
        content with {"{{placeholder}}"} tab-stops.
      </p>

      {/* Template list */}
      {templates.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--color-text-muted)", textAlign: "center", padding: "24px 0" }}>
          No custom templates yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => { setEditing(tmpl); setIsNew(false); }}
              className="flex items-center gap-3 transition-colors duration-100"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "13px",
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-primary)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px", minWidth: "70px" }}>
                {tmpl.icon}
              </span>
              <span className="flex-1">{tmpl.name}</span>
              {tmpl.is_builtin && (
                <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  built-in
                </span>
              )}
              <span style={{ color: "var(--color-text-muted)", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
                {tmpl.slug}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* New template button */}
      <button
        onClick={handleNew}
        style={{
          backgroundColor: "var(--color-accent)",
          color: "var(--color-text-on-accent)",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          fontSize: "13px",
          fontWeight: 500,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        + New Template
      </button>
    </div>
  );
}
