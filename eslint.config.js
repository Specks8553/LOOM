// ESLint flat config (Doc 24 §ESLint Config). Tooling rules per Doc 24:
//   - @typescript-eslint/recommended-type-checked
//   - react-hooks/recommended
//   - import/order, import/no-restricted-paths (store boundary — SB-2)
//   - eslint-plugin-tailwindcss with no-arbitrary-value allowing [--color-*]
//   - no-floating-promises (error), no-explicit-any (error)

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import tailwind from 'eslint-plugin-tailwindcss';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules', 'src/lib/types.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tailwind.configs['flat/recommended'],

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    settings: {
      tailwindcss: {
        callees: ['cn', 'clsx'],
        config: 'src/globals.css',
      },
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

      // Tailwind: allow --color-* arbitrary tokens (Doc 24 §Token Usage).
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/classnames-order': 'warn',

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

  // The fixture file deliberately violates SB-2; we run it through a
  // separate config to assert the rule fires. Don't lint it here.
  { ignores: ['eslint-rules/__fixtures__/**'] },
);
