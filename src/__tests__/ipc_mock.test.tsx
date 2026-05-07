// Tauri IPC mock recipe (Doc 25 §Tauri IPC mock recipe).
// Demonstrates the canonical pattern for component tests that exercise IPC wrappers.
//
// Rule: mock @tauri-apps/api/core, not the typed wrapper — that way the wrapper's
// own type-narrowing code runs as real code under test.
//
// vi.mock() calls are hoisted by vitest at compile time, so placing them after
// imports is equivalent to placing them before — all imports below see the mock.

import * as tauriCore from '@tauri-apps/api/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingShell } from '../components/shell/OnboardingShell';

import type { AppPhase } from '../lib/types';

vi.mock('@tauri-apps/api/core');

describe('OnboardingShell — IPC wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls invoke with dev_set_app_phase and typed phase arg when Continue is clicked', () => {
    const phase: AppPhase = 'locked';
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(undefined);

    render(<OnboardingShell />);

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(tauriCore.invoke).toHaveBeenCalledWith('dev_set_app_phase', { phase });
  });
});
