import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "sonner";
import { useUiStore } from "./stores/uiStore";
import { useVaultStore } from "./stores/vaultStore";
import { LockScreen } from "./components/auth/LockScreen";
import { Workspace } from "./components/layout/Workspace";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { RecoveryScreen } from "./components/onboarding/RecoveryScreen";

/**
 * Root component — 3-phase conditional rendering per Doc 11 §2.
 * appPhase: "onboarding" | "locked" | "workspace"
 */
function App() {
  const appPhase = useUiStore((s) => s.appPhase);
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const [initialized, setInitialized] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);

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
        // Config lost, worlds intact → recovery screen
        setNeedsRecovery(true);
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
        return;
      }

      // Ctrl+, → Settings
      if (e.ctrlKey && e.key === "," && appPhase === "workspace") {
        e.preventDefault();
        const uiState = useUiStore.getState();
        uiState.setSettingsOpen(!uiState.settingsOpen);
        return;
      }

      // Escape chain: multi-select clear (lower priority than modals)
      if (e.key === "Escape" && appPhase === "workspace") {
        const { selectedItems, clearSelection } = useVaultStore.getState();
        if (selectedItems.size > 0) {
          clearSelection();
        }
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
    if (needsRecovery) {
      return <RecoveryScreen />;
    }
    return <OnboardingWizard />;
  }

  if (appPhase === "locked") {
    return <LockScreen />;
  }

  // workspace
  return (
    <ErrorBoundary>
      <Workspace />
      <Toaster position="bottom-right" theme="dark" richColors />
    </ErrorBoundary>
  );
}

export default App;
