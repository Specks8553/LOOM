import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";

export function LockScreen() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isUnlocking, unlockError, setUnlocking, setUnlockError } =
    useAuthStore();
  const setAppPhase = useUiStore((s) => s.setAppPhase);

  // Auto-focus password input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = async () => {
    if (!password || isUnlocking) return;

    setUnlocking(true);
    setUnlockError(null);

    try {
      await invoke("unlock_vault", { password });
      useAuthStore.getState().setUnlocked(true);
      setAppPhase("workspace");
    } catch (e) {
      setUnlockError(String(e));
      setPassword("");
      // Re-focus input after error
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setUnlocking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleUnlock();
    }
  };

  return (
    <div className="flex items-center justify-center h-full w-full select-none"
         style={{ backgroundColor: "var(--color-bg-base)" }}>
      <div className="flex flex-col items-center gap-6 w-[320px]">
        {/* LOOM Wordmark */}
        <h1
          className="tracking-[0.2em] font-semibold"
          style={{
            fontSize: "28px",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.2em",
          }}
        >
          LOOM
        </h1>

        {/* Password Input Group */}
        <div className="w-full flex flex-col gap-2">
          <div className="relative w-full">
            <input
              ref={inputRef}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your password"
              disabled={isUnlocking}
              className="w-full pr-10 outline-none transition-colors duration-150"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: `1px solid ${unlockError ? "var(--color-error)" : "var(--color-border)"}`,
                borderRadius: "6px",
                padding: "10px 14px",
                paddingRight: "40px",
                fontSize: "14px",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: "var(--color-text-muted)" }}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Error Message */}
          {unlockError && (
            <p
              className="text-xs"
              style={{ color: "var(--color-error)" }}
            >
              {unlockError}
            </p>
          )}
        </div>

        {/* Unlock Button */}
        <button
          onClick={handleUnlock}
          disabled={!password || isUnlocking}
          className="w-full flex items-center justify-center gap-2 transition-colors duration-150"
          style={{
            backgroundColor: !password || isUnlocking
              ? "var(--color-bg-active)"
              : "var(--color-accent)",
            color: !password || isUnlocking
              ? "var(--color-text-muted)"
              : "var(--color-text-on-accent)",
            border: "none",
            borderRadius: "6px",
            padding: "10px 0",
            fontSize: "14px",
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: !password || isUnlocking ? "not-allowed" : "pointer",
          }}
        >
          {isUnlocking ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Unlocking...
            </>
          ) : (
            "Unlock"
          )}
        </button>
      </div>
    </div>
  );
}
