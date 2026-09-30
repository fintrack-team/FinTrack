import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/build/**",
    "**/.turbo/**",
    "**/temp/**",
    "apps/api/dist/**",
    "apps/api/prisma.config.ts",
    "apps/web/dist/**",
  ]),

  // API & BOT (Node.js, TypeScript)
  {
    files: ["apps/api/**/*.ts", "apps/bot/**/*.ts"],
    ignores: [
      "apps/api/test/**/*.ts",
      "apps/bot/test/**/*.ts",
      "apps/*/vitest.config.ts",
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        tsconfigRootDir: process.cwd(),
        project: ["./apps/api/tsconfig.json", "./apps/bot/tsconfig.json"],
      },
    },
    rules: {
      semi: ["error", "always"],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // API tests (TypeScript + Vitest)
  {
    files: ["apps/api/test/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
      parserOptions: {
        tsconfigRootDir: process.cwd(),
        project: "./apps/api/test/tsconfig.json",
      },
    },
    rules: {
      semi: ["error", "always"],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // WEB (React / TypeScript)
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      semi: ["error", "always"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
