import js from '@eslint/js';
import htmlPlugin from 'eslint-plugin-html';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

const IGNORE_PATTERNS = [
  'node_modules/',
  'dist/',
  '.parcel-cache/',
  'coverage/',
  '*.min.js',
  'colourful_life_v2.html',
  'evolution.html',
];

export default [
  {
    ignores: IGNORE_PATTERNS,
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      ...js.configs.recommended.plugins,
      html: htmlPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: ['function', 'class'] },
        { blankLine: 'always', prev: ['function', 'class'], next: '*' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      ],
    },
  },
  {
    files: ['**/*.html'],
    plugins: {
      html: htmlPlugin,
    },
  },
  eslintPluginPrettierRecommended,
];
