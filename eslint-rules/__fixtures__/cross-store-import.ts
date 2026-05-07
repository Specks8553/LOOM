// SB-2 fixture: this file deliberately violates the no-cross-store-imports
// rule from Doc 24. ESLint MUST flag the import below. Verified by
// `pnpm check:eslint-fixture` (exits non-zero on success).
//
// To pretend this file is at `src/stores/badStore.ts`, the fixture config
// adjacent to this file rewrites the path zone targets.
//
// eslint-disable-next-line -- intentionally NOT disabling; we want the lint to fire.

// @ts-expect-error — pretend module path; this is a fixture, not real code.
import { useAppStore } from '../../src/stores/appStore';

export function bad() {
  return useAppStore;
}
