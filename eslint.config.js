import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'release',
    'artifacts',
    'local-checks',
    'native-core-stage',
    // Generated dependency bundles are checked through their runtime sources.
    'electron/coin-sdks/**',
    'native-core',
    'build-logs',
    'native/**/build/**',
    'native/**/target/**',
    'native/kaspa_wallet_wasm/generated/**',
    'native/vendor/**',
    // Upstream/vendored dependencies are verified by provenance and compatibility
    // tests rather than applying application style rules to their source/types.
    'vendor/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs', 'modules/account-common/**/*.cjs', 'modules/evm/**/*.cjs', 'modules/sol/**/*.cjs', 'modules/trx/**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },
])
