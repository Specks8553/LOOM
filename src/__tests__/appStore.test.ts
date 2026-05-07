// Canary store unit test (Doc 25 §Store unit test recipe).
// Proves the Vitest + happy-dom setup works and demonstrates the store pattern.

import { describe, expect, it } from 'vitest';

import { useAppStore } from '../stores/appStore';

describe('appStore', () => {
  it('defaults to onboarding phase', () => {
    const state = useAppStore.getState();
    expect(state.appPhase).toBe('onboarding');
  });

  it('setAppPhase transitions to the given phase', () => {
    const { setAppPhase } = useAppStore.getState();
    setAppPhase('locked');
    expect(useAppStore.getState().appPhase).toBe('locked');
    // Reset so other tests start from a clean state.
    setAppPhase('onboarding');
  });
});
