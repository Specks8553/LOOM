// Minimal ESLint config used to verify SB-2 fires. The fixture file is
// pretended to live at `src/stores/badStore.ts` for the zone-target check;
// we configure import/no-restricted-paths to treat the fixture directory
// as if it were inside `src/stores`, then assert the rule fires when it
// imports from `src/stores/appStore`.
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js'] },
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './eslint-rules/__fixtures__',
              from: './src/stores',
              message: 'SB-2: stores must not import each other (Doc 24 §No Cross-Store Imports).',
            },
          ],
        },
      ],
    },
  },
];
