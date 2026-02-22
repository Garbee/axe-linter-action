import globals from 'globals'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.es2015
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    }
  },
  {
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {}
  },
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/.nyc_output/']
  }
]
