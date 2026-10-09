import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'test-results', 'playwright-report', '.pgtest'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Rendering untrusted text as HTML is forbidden in this app.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Do not inject HTML; render text.' },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Do not inject HTML; use textContent or React.' },
      ],
    },
  },
  {
    files: ['src/sw/**/*.js', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.serviceworker, ...globals.node, __PRECACHE__: 'readonly' } },
  },
);
