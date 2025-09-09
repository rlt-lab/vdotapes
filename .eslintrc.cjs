module.exports = {
  root: true,
  env: { es2022: true, browser: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  settings: {
    'import/resolver': {
      node: { extensions: ['.js', '.ts', '.d.ts'] }
    }
  },
  rules: {
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'import/order': [
      'warn',
      { 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: true } }
    ],
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      files: ['app/**/*.js'],
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      env: { browser: true, node: false }
    },
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'commonjs'
        // For type-aware rules, add:
        // project: ['./src/tsconfig.json', './app/tsconfig.json'],
        // tsconfigRootDir: __dirname
      }
    }
  ],
  ignorePatterns: ['dist/**', 'node_modules/**', 'dist/packages/**']
};

