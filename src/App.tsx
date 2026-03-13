import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface WorldMeta {
  id: string;
  name: string;
  tags: string[];
  cover_image: string | null;
  accent_color: string;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

/**
 * Phase 1 Test Page — verifies all Tauri commands work.
 * This will be replaced with proper routing in Phase 2.
 */
function App() {
  const [log, setLog] = useState<string[]>([]);
  const [password, setPassword] = useState("testpass123");
  const [worldName, setWorldName] = useState("Test World");

  const addLog = (msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleCheckConfig = async () => {
    try {
      const exists = await invoke<boolean>("check_app_config");
      addLog(`check_app_config → ${exists}`);
    } catch (e) {
      addLog(`check_app_config ERROR: ${e}`);
    }
  };

  const handleCreateConfig = async () => {
    try {
      await invoke("create_app_config", { password });
      addLog(`create_app_config("${password}") → OK`);
    } catch (e) {
      addLog(`create_app_config ERROR: ${e}`);
    }
  };

  const handleUnlock = async () => {
    try {
      await invoke("unlock_vault", { password });
      addLog(`unlock_vault("${password}") → OK`);
    } catch (e) {
      addLog(`unlock_vault ERROR: ${e}`);
    }
  };

  const handleLock = async () => {
    try {
      await invoke("lock_vault");
      addLog("lock_vault → OK");
    } catch (e) {
      addLog(`lock_vault ERROR: ${e}`);
    }
  };

  const handleCreateWorld = async () => {
    try {
      const meta = await invoke<WorldMeta>("create_world", {
        name: worldName,
        tags: [],
      });
      addLog(`create_world("${worldName}") → id=${meta.id}`);
    } catch (e) {
      addLog(`create_world ERROR: ${e}`);
    }
  };

  const handleListWorlds = async () => {
    try {
      const worlds = await invoke<WorldMeta[]>("list_worlds");
      addLog(`list_worlds → ${worlds.length} world(s)`);
      for (const w of worlds) {
        addLog(`  - ${w.name} (${w.id})`);
      }
    } catch (e) {
      addLog(`list_worlds ERROR: ${e}`);
    }
  };

  return (
    <div
      style={{
        padding: "2rem",
        fontFamily: "var(--font-sans)",
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-base)",
        height: "100vh",
        overflow: "auto",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>
        LOOM — Phase 1 Test Console
      </h1>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Password
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              background: "var(--color-bg-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "0.4rem 0.6rem",
              color: "var(--color-text-primary)",
              width: "200px",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            World Name
          </label>
          <input
            type="text"
            value={worldName}
            onChange={(e) => setWorldName(e.target.value)}
            style={{
              background: "var(--color-bg-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "0.4rem 0.6rem",
              color: "var(--color-text-primary)",
              width: "200px",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {[
          { label: "Check Config", handler: handleCheckConfig },
          { label: "Create Config", handler: handleCreateConfig },
          { label: "Unlock", handler: handleUnlock },
          { label: "Lock", handler: handleLock },
          { label: "Create World", handler: handleCreateWorld },
          { label: "List Worlds", handler: handleListWorlds },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.handler}
            style={{
              background: "var(--color-accent)",
              color: "var(--color-text-on-accent)",
              border: "none",
              borderRadius: "4px",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 500,
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      <div
        style={{
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "1rem",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          lineHeight: "1.6",
          maxHeight: "60vh",
          overflow: "auto",
        }}
      >
        {log.length === 0 ? (
          <span style={{ color: "var(--color-text-muted)" }}>
            Click a button above to test Tauri commands...
          </span>
        ) : (
          log.map((entry, i) => (
            <div
              key={i}
              style={{
                color: entry.includes("ERROR")
                  ? "var(--color-error)"
                  : entry.includes("→ OK") || entry.includes("→ true")
                    ? "var(--color-success)"
                    : "var(--color-text-secondary)",
              }}
            >
              {entry}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
