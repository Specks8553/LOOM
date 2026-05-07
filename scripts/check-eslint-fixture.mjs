// SB-2 verification harness: runs ESLint against the cross-store-import
// fixture using the dedicated fixture config; expects the run to fail with
// at least one `import/no-restricted-paths` violation. Inverts the exit
// code so a violation = success.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    '--no-install',
    'eslint',
    '--no-config-lookup',
    '-c',
    'eslint-rules/__fixtures__/cross-store.eslint.config.js',
    'eslint-rules/__fixtures__/cross-store-import.ts',
  ],
  { stdio: 'pipe', encoding: 'utf8', shell: true },
);

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
const fired = stdout.includes('import/no-restricted-paths');

if (!fired) {
  console.error('SB-2 fixture FAILED: import/no-restricted-paths did not fire.');
  console.error('--- stdout ---\n' + stdout);
  console.error('--- stderr ---\n' + stderr);
  process.exit(1);
}

console.log('SB-2 fixture OK: import/no-restricted-paths fired as expected.');
process.exit(0);
