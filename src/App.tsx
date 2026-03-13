import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "./stores/uiStore";
import { LockScreen } from "./components/auth/LockScreen";
import { Workspace } from "./components/layout/Workspace";
import { ErrorBoundary } from "./components/ErrorBoundary";

/**
 * Root component — 3-phase conditional rendering per Doc 11 §2.
 * appPhase: "onboarding" | "locked" | "workspace"
 */
function App() {
  const appPhase = useUiStore((s) => s.appPhase);
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const [initialized, setInitialized] = useState(false);

  // Mount evaluation: check localStorage + check_app_config
  useEffect(() => {
    async function evaluate() {
      const onboardingDone =
        localStorage.getItem("onboarding_complete") === "true";
      let configExists = false;

      try {
        configExists = await invoke<boolean>("check_app_config");
      } catch {
        // Config check failed — treat as missing
      }

      if (!onboardingDone && !configExists) {
        // First-ever launch → onboarding
        setAppPhase("onboarding");
      } else if (onboardingDone && !configExists) {
        // Config lost, worlds intact → recovery (rendered as onboarding for now)
        setAppPhase("onboarding");
      } else {
        // Config exists → lock screen
        setAppPhase("locked");
      }

      setInitialized(true);
    }

    evaluate();
  }, [setAppPhase]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L → Lock
      if (e.ctrlKey && e.key === "l" && appPhase === "workspace") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("loom:lock"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appPhase]);

  // Show nothing until mount evaluation completes
  if (!initialized) {
    return (
      <div
        className="h-full w-full"
        style={{ backgroundColor: "var(--color-bg-base)" }}
      />
    );
  }

  if (appPhase === "onboarding") {
    // Placeholder for Phase 3
    return (
      <div
        className="flex items-center justify-center h-full w-full"
        style={{ backgroundColor: "var(--color-bg-base)" }}
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>
          Onboarding Wizard — Coming in Phase 3
        </p>
      </div>
    );
  }

  if (appPhase === "locked") {
    return <LockScreen />;
  }

  // workspace
  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  );
}

export default App;
