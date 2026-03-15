import { useUiStore } from "../stores/uiStore";

const NARROW_BREAKPOINT = 1200;

/**
 * Initializes viewport watcher per Doc 11 §13.
 * Auto-collapses Control Pane below 1200px.
 * Does NOT auto-reopen on widen.
 * Returns cleanup function.
 */
export function initViewportWatcher(): () => void {
  const check = () => {
    const narrow = window.innerWidth < NARROW_BREAKPOINT;
    const store = useUiStore.getState();

    if (narrow && !store.viewportNarrow) {
      store.setViewportNarrow(true);
      store.setRightPaneCollapsed(true);
    } else if (!narrow && store.viewportNarrow) {
      store.setViewportNarrow(false);
      // Intentionally do NOT reopen — user must manually expand
    }
  };

  window.addEventListener("resize", check);
  check(); // initial check

  return () => window.removeEventListener("resize", check);
}
