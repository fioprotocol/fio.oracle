// eslint.config.js
import eslintprettier from 'eslint-plugin-prettier';
import eslintplugin from 'eslint-plugin-import';
import babelParser from '@babel/eslint-parser';

export default [
  {
    files: ["**/*.js"],
    ignores: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: babelParser, // Use Babel parser for modern features
      parserOptions: {
        requireConfigFile: false, // Ensure Babel can be used without a config file
        babelOptions: {
          presets: ['@babel/preset-env'],
          plugins: ['@babel/plugin-syntax-import-assertions'],
        },
      },
    },
    plugins: {
      prettier: eslintprettier,
      import: eslintplugin,
    },
    rules: {
      "prettier/prettier": [
        "error",
        {
          trailingComma: "all",
          printWidth: 90,
          singleQuote: true,
        },
      ],
      "no-unused-vars": "error",
      "prefer-const": "error",
      "no-underscore-dangle": "off",
      "comma-dangle": ["error", "always-multiline"],
      "no-console": "off",
      "import/order": [
        "error",
        {
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          "newlines-between": "always-and-inside-groups",
          groups: [
            "builtin",
            "external",
            "internal",
            ["sibling", "parent"],
            "index",
            "object",
            "type",
          ],
        },
      ],
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".json"],
        },
      },
    },
  },
];
