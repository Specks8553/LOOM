// Tauri IPC mock recipe (Doc 25 §Tauri IPC mock recipe).
// Tests that OnboardingShell calls setup_vault with the correct args after
// both steps of the wizard are completed.
//
// Rule: mock @tauri-apps/api/core, not the typed wrapper — that way the wrapper's
// own type-narrowing code runs as real code under test.

import * as tauriCore from '@tauri-apps/api/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingShell } from '../components/shell/OnboardingShell';

vi.mock('@tauri-apps/api/core');

describe('OnboardingShell — IPC wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls invoke with setup_vault after completing both wizard steps', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValue(undefined);

    render(<OnboardingShell />);

    // Step 1: fill in password + confirm and continue.
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'test-password-123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), {
      target: { value: 'test-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    // Step 2: skip the API key.
    const skipButton = await screen.findByRole('button', { name: /Skip for now/i });
    fireEvent.click(skipButton);

    expect(tauriCore.invoke).toHaveBeenCalledWith('setup_vault', {
      password: 'test-password-123',
      apiKey: null,
    });
  });
});
