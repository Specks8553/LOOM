// Settings field schema + validators (Doc 20 §Validation, §Tab Specifications).
//
// Single source of truth on the frontend, mirroring `services/settings.rs`'s
// `validate_setting`. The backend revalidates every write — this layer is the
// primary UX (inline errors, auto-save suppression).

/** How a field is rendered in the detail pane. */
export type FieldKind = 'slider' | 'number' | 'hex' | 'text' | 'select' | 'toggle';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** True when the World chapter may override this key. */
  worldOverridable: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Hex fields: when true an empty value is valid (feature colour → accent). */
  allowEmpty?: boolean;
  hint?: string;
}

export interface SettingsTabSpec {
  id: string;
  label: string;
  /** Generic field tabs list their fields; special tabs render bespoke UI. */
  fields?: FieldSpec[];
  /** App / World — `app` tabs never appear in the World chapter. */
  appOnly?: boolean;
}

const MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
];

// --- Field groups ---------------------------------------------------------

const APPEARANCE_FIELDS: FieldSpec[] = [
  {
    key: 'accent_color',
    label: 'Accent colour',
    kind: 'hex',
    worldOverridable: true,
    hint: 'Drives the accent across the app. Hover and subtle tones are derived.',
  },
  {
    key: 'body_font',
    label: 'Prose font',
    kind: 'select',
    worldOverridable: true,
    options: [
      { value: 'serif', label: 'Serif' },
      { value: 'sans', label: 'Sans-serif' },
      { value: 'mono', label: 'Monospace' },
    ],
  },
];

const GEMINI_FIELDS: FieldSpec[] = [
  {
    key: 'text_model_name',
    label: 'Model',
    kind: 'select',
    worldOverridable: true,
    options: MODEL_OPTIONS,
  },
  {
    key: 'gen_temperature',
    label: 'Temperature',
    kind: 'slider',
    worldOverridable: true,
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    key: 'gen_top_p',
    label: 'Top-P',
    kind: 'slider',
    worldOverridable: true,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'gen_top_k',
    label: 'Top-K',
    kind: 'slider',
    worldOverridable: true,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'gen_max_output_tokens',
    label: 'Max output tokens',
    kind: 'number',
    worldOverridable: true,
    min: 1,
    max: 32768,
  },
  {
    key: 'gen_summarise_temperature',
    label: 'Summarise temperature',
    kind: 'slider',
    worldOverridable: true,
    min: 0,
    max: 2,
    step: 0.05,
    hint: 'Used for Accordion summarisation.',
  },
  {
    key: 'gen_summarise_top_p',
    label: 'Summarise Top-P',
    kind: 'slider',
    worldOverridable: true,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'gen_summarise_top_k',
    label: 'Summarise Top-K',
    kind: 'slider',
    worldOverridable: true,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'gen_summarise_max_output_tokens',
    label: 'Summarise max output tokens',
    kind: 'number',
    worldOverridable: true,
    min: 1,
    max: 32768,
  },
  {
    key: 'cache_ttl_secs',
    label: 'Cache TTL',
    kind: 'slider',
    worldOverridable: true,
    min: 60,
    max: 86400,
    step: 60,
    unit: 's',
  },
  {
    key: 'cache_min_tokens',
    label: 'Cache auto-create threshold',
    kind: 'number',
    worldOverridable: true,
    min: 0,
    max: 10000000,
  },
  {
    key: 'context_token_limit',
    label: 'Context token limit',
    kind: 'number',
    worldOverridable: true,
    min: 1,
    max: 10000000,
  },
  {
    key: 'inline_context_fallback',
    label: 'Inline fallback on cache failure',
    kind: 'toggle',
    worldOverridable: false,
    hint: 'When a cache create fails, deliver context inline instead of aborting the send.',
  },
];

const FEATURE_FIELDS: FieldSpec[] = [
  {
    key: 'ghostwriter_color',
    label: 'Ghostwriter colour',
    kind: 'hex',
    worldOverridable: true,
    allowEmpty: true,
    hint: 'Empty tracks the accent colour.',
  },
  {
    key: 'accordion_color',
    label: 'Accordion colour',
    kind: 'hex',
    worldOverridable: true,
    allowEmpty: true,
    hint: 'Empty tracks the accent colour.',
  },
  {
    key: 'feedback_color',
    label: 'Feedback colour',
    kind: 'hex',
    worldOverridable: true,
    allowEmpty: true,
    hint: 'Empty resets to the default amber (does not track accent).',
  },
  {
    key: 'mark_color',
    label: 'Mark colour',
    kind: 'hex',
    worldOverridable: true,
    allowEmpty: true,
    hint: 'Empty resets to the default rose (does not track accent).',
  },
];

const GENERAL_FIELDS: FieldSpec[] = [
  {
    key: 'auto_lock_secs',
    label: 'Auto-lock timer',
    kind: 'slider',
    worldOverridable: false,
    min: 60,
    max: 86400,
    step: 60,
    unit: 's',
    hint: 'The vault locks after this much inactivity.',
  },
];

// --- Tab specs ------------------------------------------------------------

export const SETTINGS_TABS: SettingsTabSpec[] = [
  { id: 'general', label: 'General', fields: GENERAL_FIELDS, appOnly: true },
  { id: 'appearance', label: 'Appearance', fields: APPEARANCE_FIELDS },
  { id: 'gemini', label: 'Gemini', fields: GEMINI_FIELDS },
  { id: 'system_instructions', label: 'System Instructions' },
  { id: 'templates', label: 'Templates' },
  { id: 'features', label: 'Features', fields: FEATURE_FIELDS },
  { id: 'developer', label: 'Developer', appOnly: true },
];

/** Tabs visible in a given chapter. */
export function tabsForChapter(chapter: 'app' | 'world'): SettingsTabSpec[] {
  return SETTINGS_TABS.filter((t) => chapter === 'app' || !t.appOnly);
}

/** Every field across the field-driven tabs (used for search). */
export function allFields(): FieldSpec[] {
  return SETTINGS_TABS.flatMap((t) => t.fields ?? []);
}

// --- Validation -----------------------------------------------------------

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/**
 * Validate a field value. Returns an error message, or `null` when valid.
 * Mirrors `services/settings.rs::validate_setting`.
 */
export function validateField(spec: FieldSpec, value: string): string | null {
  const v = value.trim();
  switch (spec.kind) {
    case 'hex': {
      if (v === '') return spec.allowEmpty ? null : `${spec.label} cannot be empty.`;
      return isHexColor(v) ? null : 'Enter a hex colour like #6b9f78.';
    }
    case 'toggle':
      return v === 'true' || v === 'false' ? null : 'Must be on or off.';
    case 'select':
      return v === '' ? `${spec.label} cannot be empty.` : null;
    case 'text':
      return v === '' ? `${spec.label} cannot be empty.` : null;
    case 'slider':
    case 'number': {
      if (v === '') return `${spec.label} is required.`;
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Enter a number.';
      const isIntField = spec.step === undefined || Number.isInteger(spec.step);
      if (isIntField && !Number.isInteger(n)) return 'Enter a whole number.';
      if (spec.min !== undefined && n < spec.min) return `Minimum is ${spec.min}.`;
      if (spec.max !== undefined && n > spec.max) return `Maximum is ${spec.max}.`;
      return null;
    }
    default:
      return null;
  }
}
