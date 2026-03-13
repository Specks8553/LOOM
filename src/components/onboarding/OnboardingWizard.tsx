import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Eye,
  EyeOff,
  Loader2,
  Check,
  X,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";

const TOTAL_STEPS = 4;

// ─── Step Indicator Dots ──────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor:
              i <= current
                ? "var(--color-accent)"
                : "var(--color-border)",
            transition: "background-color 200ms ease",
          }}
        />
      ))}
    </div>
  );
}

// ─── Reusable password input ──────────────────────────────────────────────────

function PasswordInput({
  value,
  onChange,
  placeholder,
  show,
  onToggle,
  disabled,
  inputRef,
  error,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  error?: boolean;
  onBlur?: () => void;
}) {
  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full pr-10 outline-none transition-colors duration-150"
        style={{
          backgroundColor: "var(--color-bg-hover)",
          border: `1px solid ${error ? "var(--color-error)" : "var(--color-border)"}`,
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
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: "var(--color-text-muted)" }}
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
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
          fontSize: "15px",
          fontFamily: "var(--font-theater-body)",
          color: "var(--color-text-secondary)",
        }}
      >
        Your private AI writing companion.
      </p>
      <p
        style={{
          fontSize: "13px",
          color: "var(--color-text-muted)",
          maxWidth: "340px",
          lineHeight: 1.6,
        }}
      >
        Everything you write stays on your device,
        encrypted with a password only you know.
      </p>
    </div>
  );
}

// ─── Step 2: Create Master Password ───────────────────────────────────────────

function StepPassword({
  password,
  setPassword,
  confirm,
  setConfirm,
  showPw,
  setShowPw,
  showConfirm,
  setShowConfirm,
  confirmBlurred,
  setConfirmBlurred,
  error,
}: {
  password: string;
  setPassword: (v: string) => void;
  confirm: string;
  setConfirm: (v: string) => void;
  showPw: boolean;
  setShowPw: (v: boolean) => void;
  showConfirm: boolean;
  setShowConfirm: (v: boolean) => void;
  confirmBlurred: boolean;
  setConfirmBlurred: (v: boolean) => void;
  error: string | null;
}) {
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => { pwRef.current?.focus(); }, []);

  const meetsLength = password.length >= 8;
  const mismatch = confirmBlurred && confirm.length > 0 && password !== confirm;

  return (
    <div className="flex flex-col gap-4">
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Create a Master Password
      </h2>
      <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        This password encrypts all your data. It cannot be recovered if lost.
      </p>

      {/* Password field */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          Password
        </label>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Enter a password"
          show={showPw}
          onToggle={() => setShowPw(!showPw)}
          inputRef={pwRef}
        />
        <span
          style={{
            fontSize: "12px",
            color: meetsLength ? "var(--color-success)" : "var(--color-text-muted)",
            transition: "color 200ms ease",
          }}
        >
          At least 8 characters.
        </span>
      </div>

      {/* Confirm field */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          Confirm password
        </label>
        <PasswordInput
          value={confirm}
          onChange={setConfirm}
          placeholder="Re-enter your password"
          show={showConfirm}
          onToggle={() => setShowConfirm(!showConfirm)}
          error={mismatch}
          onBlur={() => setConfirmBlurred(true)}
        />
        {mismatch && (
          <span className="flex items-center gap-1" style={{ fontSize: "12px", color: "var(--color-error)" }}>
            <X size={12} /> Passwords do not match.
          </span>
        )}
      </div>

      {/* Backend error */}
      {error && (
        <p style={{ fontSize: "12px", color: "var(--color-error)" }}>{error}</p>
      )}
    </div>
  );
}

// ─── Step 3: Connect to Gemini ────────────────────────────────────────────────

function StepApiKey({
  apiKey,
  setApiKey,
  showKey,
  setShowKey,
  testState,
  onTest,
}: {
  apiKey: string;
  setApiKey: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  testState: "idle" | "testing" | "valid" | "invalid";
  onTest: () => void;
}) {
  const [guideOpen, setGuideOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col gap-4">
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Connect to Gemini
      </h2>
      <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        LOOM uses the Gemini API to generate story text.
        You will need a free API key from Google.
      </p>

      {/* Collapsible guide */}
      <button
        type="button"
        onClick={() => setGuideOpen(!guideOpen)}
        className="flex items-center gap-1 text-left"
        style={{ fontSize: "13px", color: "var(--color-accent-text)" }}
      >
        {guideOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        How to get your API key
      </button>
      {guideOpen && (
        <ol
          className="list-decimal pl-5 flex flex-col gap-1"
          style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.6 }}
        >
          <li>Go to Google AI Studio (<span style={{ color: "var(--color-accent-text)" }}>aistudio.google.com</span>)</li>
          <li>Sign in with your Google account</li>
          <li>Click "Get API key" then "Create API key"</li>
          <li>Copy the key and paste it below</li>
        </ol>
      )}

      <p style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
        Your key stays on your device, encrypted with your password.
        It is never sent to Anthropic or any other party.
      </p>

      {/* API Key Input */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          API Key
        </label>
        <PasswordInput
          value={apiKey}
          onChange={setApiKey}
          placeholder="Paste your Gemini API key"
          show={showKey}
          onToggle={() => setShowKey(!showKey)}
          inputRef={inputRef}
        />
      </div>

      {/* Test button + status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={!apiKey.trim() || testState === "testing"}
          className="flex items-center gap-2 transition-colors duration-150"
          style={{
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "13px",
            color:
              !apiKey.trim() || testState === "testing"
                ? "var(--color-text-muted)"
                : "var(--color-text-primary)",
            cursor:
              !apiKey.trim() || testState === "testing"
                ? "not-allowed"
                : "pointer",
          }}
        >
          {testState === "testing" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : null}
          Test Key
        </button>

        {testState === "valid" && (
          <span className="flex items-center gap-1" style={{ fontSize: "12px", color: "var(--color-success)" }}>
            <Check size={14} /> Key is valid.
          </span>
        )}
        {testState === "invalid" && (
          <span className="flex items-center gap-1" style={{ fontSize: "12px", color: "var(--color-error)" }}>
            <X size={14} /> Key rejected by Gemini. Check and try again.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Create First World ───────────────────────────────────────────────

function StepCreateWorld({
  worldName,
  setWorldName,
}: {
  worldName: string;
  setWorldName: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col gap-4">
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Create Your First World
      </h2>
      <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        A world holds all the stories, documents, and settings for one creative
        project. You can create more worlds later.
      </p>

      <div className="flex flex-col gap-1">
        <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          World name
        </label>
        <input
          ref={inputRef}
          type="text"
          value={worldName}
          onChange={(e) => setWorldName(e.target.value.slice(0, 80))}
          placeholder="My World"
          className="w-full outline-none transition-colors duration-150"
          style={{
            backgroundColor: "var(--color-bg-hover)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            padding: "10px 14px",
            fontSize: "14px",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
          }}
        />
      </div>
    </div>
  );
}

// ─── Recovery File Prompt ─────────────────────────────────────────────────────

function RecoveryPrompt({
  onSave,
  onSkip,
  saving,
}: {
  onSave: () => void;
  onSkip: () => void;
  saving: boolean;
}) {
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
        <div className="flex flex-col gap-4">
          <h2
            style={{
              fontSize: "16px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            Save your recovery file
          </h2>
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            If LOOM's configuration is ever lost, this file lets you restore
            access to your worlds.
          </p>
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            It contains only technical parameters — not your password or any of
            your writing.
          </p>
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Store it somewhere safe, separate from your worlds.
          </p>

          <div className="flex items-center justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={onSkip}
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
              Skip
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "var(--color-text-on-accent)",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Recovery File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);

  // Wizard state
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Step 2: Password
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmBlurred, setConfirmBlurred] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // Step 3: API Key
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "valid" | "invalid">("idle");

  // Step 4: World
  const [worldName, setWorldName] = useState("");
  const [worldError, setWorldError] = useState<string | null>(null);

  // Recovery prompt (shown after wizard completes)
  const [showRecovery, setShowRecovery] = useState(false);
  const [savingRecovery, setSavingRecovery] = useState(false);

  // Validation per step
  const isStepValid = () => {
    switch (step) {
      case 0: return true; // Welcome
      case 1: return password.length >= 8 && password === confirm;
      case 2: return apiKey.trim().length > 0;
      case 3: return worldName.trim().length >= 2;
      default: return false;
    }
  };

  const handleTestKey = async () => {
    setTestState("testing");
    try {
      await invoke("validate_and_store_api_key", { key: apiKey.trim() });
      setTestState("valid");
    } catch {
      setTestState("invalid");
    }
  };

  const handleNext = async () => {
    if (!isStepValid() || loading) return;

    // Step 2 → create app config
    if (step === 1) {
      setLoading(true);
      setPwError(null);
      try {
        await invoke("create_app_config", { password });
        setStep(2);
      } catch (e) {
        setPwError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 3 → store API key in memory if not already tested
    if (step === 2) {
      // If key wasn't tested yet, validate & store now
      if (testState !== "valid") {
        setLoading(true);
        try {
          await invoke("validate_and_store_api_key", { key: apiKey.trim() });
        } catch {
          // Key not validated — store raw in AppState anyway
          // PRD says Next is enabled when field is non-empty, test is optional
        }
        setLoading(false);
      }
      setStep(3);
      return;
    }

    // Step 4 → create world, persist API key, finish
    if (step === 3) {
      setLoading(true);
      setWorldError(null);
      try {
        // If API key wasn't stored via test, store it now
        try {
          await invoke("validate_and_store_api_key", { key: apiKey.trim() });
        } catch {
          // Ignore — key may already be stored from step 3 or test
        }

        await invoke("create_world", { name: worldName.trim(), tags: null });
        await invoke("save_api_key_to_db");

        // Mark onboarding complete
        localStorage.setItem("onboarding_complete", "true");

        // Show recovery prompt
        setShowRecovery(true);
      } catch (e) {
        setWorldError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Default: advance
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isStepValid() && !loading) {
      handleNext();
    }
  };

  const finishOnboarding = () => {
    useAuthStore.getState().setUnlocked(true);
    setAppPhase("workspace");
  };

  const handleSaveRecovery = async () => {
    setSavingRecovery(true);
    try {
      const recoveryJson = await invoke<string>("generate_recovery_file");
      const filePath = await save({
        title: "Save Recovery File",
        defaultPath: "loom_recovery.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, recoveryJson);
      }
    } catch {
      // User cancelled or error — not critical
    } finally {
      setSavingRecovery(false);
      finishOnboarding();
    }
  };

  const handleSkipRecovery = () => {
    finishOnboarding();
  };

  // Show recovery prompt overlay
  if (showRecovery) {
    return (
      <RecoveryPrompt
        onSave={handleSaveRecovery}
        onSkip={handleSkipRecovery}
        saving={savingRecovery}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center h-full w-full select-none"
      style={{ backgroundColor: "var(--color-bg-base)" }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          width: "480px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {/* Step content */}
        {step === 0 && <StepWelcome />}
        {step === 1 && (
          <StepPassword
            password={password}
            setPassword={setPassword}
            confirm={confirm}
            setConfirm={setConfirm}
            showPw={showPw}
            setShowPw={setShowPw}
            showConfirm={showConfirm}
            setShowConfirm={setShowConfirm}
            confirmBlurred={confirmBlurred}
            setConfirmBlurred={setConfirmBlurred}
            error={pwError}
          />
        )}
        {step === 2 && (
          <StepApiKey
            apiKey={apiKey}
            setApiKey={setApiKey}
            showKey={showKey}
            setShowKey={setShowKey}
            testState={testState}
            onTest={handleTestKey}
          />
        )}
        {step === 3 && (
          <StepCreateWorld
            worldName={worldName}
            setWorldName={setWorldName}
          />
        )}

        {/* World error */}
        {step === 3 && worldError && (
          <p style={{ fontSize: "12px", color: "var(--color-error)" }}>{worldError}</p>
        )}

        {/* Footer: dots + navigation */}
        <div className="flex flex-col gap-4">
          <StepDots current={step} />

          <div className="flex items-center justify-between">
            {/* Back button */}
            {step > 0 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={loading}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  padding: "8px 16px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: loading ? "not-allowed" : "pointer",
                  borderRadius: "6px",
                }}
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {/* Next / Get Started button */}
            <button
              type="button"
              onClick={handleNext}
              disabled={!isStepValid() || loading}
              className="flex items-center gap-2 transition-colors duration-150"
              style={{
                backgroundColor:
                  !isStepValid() || loading
                    ? "var(--color-bg-active)"
                    : "var(--color-accent)",
                color:
                  !isStepValid() || loading
                    ? "var(--color-text-muted)"
                    : "var(--color-text-on-accent)",
                border: "none",
                borderRadius: "6px",
                padding: "8px 20px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: !isStepValid() || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {step === 3 ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
