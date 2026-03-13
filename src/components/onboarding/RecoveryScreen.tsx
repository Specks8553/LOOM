import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { Loader2 } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

/**
 * Recovery Screen — shown when onboarding_complete=true but app_config.json is missing.
 * Per Doc 07 §6.
 */
export function RecoveryScreen() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);

  const [mode, setMode] = useState<"choose" | "password">("choose");
  const [recoveryJson, setRecoveryJson] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    try {
      const filePath = await open({
        title: "Select Recovery File",
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
        directory: false,
      });

      if (!filePath) return;

      const content = await readTextFile(filePath as string);
      setRecoveryJson(content);
      setMode("password");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRestore = async () => {
    if (!password || password.length < 8 || loading) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("restore_app_config", {
        recoveryJson,
        password,
      });
      // Config restored — go to lock screen
      setAppPhase("locked");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFreshInstall = () => {
    localStorage.removeItem("onboarding_complete");
    // Re-evaluate will show onboarding wizard
    window.location.reload();
  };

  return (
    <div
      className="flex items-center justify-center h-full w-full select-none"
      style={{ backgroundColor: "var(--color-bg-base)" }}
    >
      <div
        style={{
          width: "480px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          padding: "32px",
        }}
      >
        {mode === "choose" ? (
          <div className="flex flex-col items-center text-center gap-5">
            <h1
              style={{
                fontSize: "28px",
                fontWeight: 600,
                letterSpacing: "0.15em",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
              }}
            >
              LOOM
            </h1>
            <p
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Configuration file missing.
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
                lineHeight: 1.6,
                maxWidth: "360px",
              }}
            >
              Your worlds are intact but LOOM needs your recovery file to
              restore access.
            </p>

            {error && (
              <p style={{ fontSize: "12px", color: "var(--color-error)" }}>{error}</p>
            )}

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={handleImport}
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "var(--color-text-on-accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Import Recovery File
              </button>
              <button
                type="button"
                onClick={handleFreshInstall}
                style={{
                  backgroundColor: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Fresh Install
              </button>
            </div>
          </div>
        ) : (
          /* Password entry for recovery restore */
          <div className="flex flex-col gap-4">
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Enter Your Password
            </h2>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              Enter the master password you used when you first set up LOOM.
              This will re-derive the encryption key from the recovery file.
            </p>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRestore();
              }}
              placeholder="Enter your password"
              autoFocus
              className="w-full outline-none transition-colors duration-150"
              style={{
                backgroundColor: "var(--color-bg-hover)",
                border: `1px solid ${error ? "var(--color-error)" : "var(--color-border)"}`,
                borderRadius: "6px",
                padding: "10px 14px",
                fontSize: "14px",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
              }}
            />

            {error && (
              <p style={{ fontSize: "12px", color: "var(--color-error)" }}>{error}</p>
            )}

            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => { setMode("choose"); setError(null); }}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  padding: "8px 16px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  borderRadius: "6px",
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={password.length < 8 || loading}
                className="flex items-center gap-2"
                style={{
                  backgroundColor:
                    password.length < 8 || loading
                      ? "var(--color-bg-active)"
                      : "var(--color-accent)",
                  color:
                    password.length < 8 || loading
                      ? "var(--color-text-muted)"
                      : "var(--color-text-on-accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: password.length < 8 || loading ? "not-allowed" : "pointer",
                }}
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Restore
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
