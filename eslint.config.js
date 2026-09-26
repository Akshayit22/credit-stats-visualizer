import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One lint config for the whole repository. Each workspace adds what only it
 * needs (browser globals for the frontend, Node globals for the backend) in its
 * own block below; the rules that encode the project's conventions apply to all.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // The Next.js application being ported. Removed once the port is done.
      'app/**',
      'src/**',
      'tests/**',
      'scripts/**',
      'design/**',
      'public/**',
      '.next/**',
      '.sst/**',
      'sst.config.ts',
      'next.config.ts',
      'next-env.d.ts',
      'eslint.config.mjs',
      'vitest.config.ts',
      'playwright.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['shared/**/*.ts'],
    languageOptions: { globals: { ...globals.es2023 } },
  },
  {
    // Tests read fixtures from disk.
    files: ['**/test/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
