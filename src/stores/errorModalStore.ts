import { create } from 'zustand';

/** Blocking-modal error tier (Doc 12 §Error Display Hierarchy §3). Holds the
 *  single active blocking error, if any. Rendered by `<ErrorModal />` in
 *  App.tsx. `surfaceError` (src/lib/errors.ts) pushes here for the modal-tier
 *  variants (crypto / database / config corruption). */
export interface BlockingError {
  title: string;
  body: string;
  /** Label for the single primary action. Defaults to "Dismiss". */
  actionLabel?: string;
}

interface ErrorModalState {
  current: BlockingError | null;
  show: (err: BlockingError) => void;
  dismiss: () => void;
}

export const useErrorModalStore = create<ErrorModalState>((set) => ({
  current: null,
  show: (err) => set({ current: err }),
  dismiss: () => set({ current: null }),
}));
