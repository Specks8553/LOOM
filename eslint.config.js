// ESLint flat config (Doc 24 §ESLint Config). Tooling rules per Doc 24:
//   - @typescript-eslint/recommended-type-checked
//   - react-hooks/recommended
//   - import/order, import/no-restricted-paths (store boundary — SB-2)
//   - no-floating-promises (error), no-explicit-any (error)
// Note: eslint-plugin-tailwindcss dropped — incompatible with Tailwind v4.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules', 'src/lib/types.ts', '.claude/'] },

  // Base JS rules for all files.
  js.configs.recommended,

  // Type-checked TS rules scoped to source files only (requires tsconfig coverage).
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
        node: true,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // SB-2: stores never import each other (Doc 24 §No Cross-Store Imports).
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/stores',
              from: './src/stores',
              message:
                'Stores must not import each other. Compose in components or hooks (Doc 06 §Store Rules; Doc 24 §No Cross-Store Imports).',
            },
          ],
        },
      ],

      // Doc 24 §General — typescript discipline.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      // Imports.
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          alphabetize: { order: 'asc' },
          'newlines-between': 'always',
        },
      ],
    },
  },

  // Node.js scripts (tools, not source) need Node globals.
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'eslint-rules/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  // The fixture file deliberately violates SB-2; run through its own config.
  { ignores: ['eslint-rules/__fixtures__/**'] },
);
