import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "state/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Express tells an error handler apart by its four parameters, used or not.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/server/**/*.ts", "tests/**/*.ts", "*.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
