import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';
import prettier from 'eslint-config-prettier';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'design/**',
      // The pdf.js worker is a vendored build artefact, copied in by postinstall.
      'public/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Scripts are CLIs: printing is the point.
    files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
