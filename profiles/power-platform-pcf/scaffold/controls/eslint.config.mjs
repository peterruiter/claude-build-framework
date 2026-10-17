// The pac pcf init lint set (Power Apps checker rules included: paCheckerHosted), plus the
// profile's rules: no console outside shared/diagnostics.ts (privacy: nothing about a person
// reaches the browser console), no network calls the manifest does not declare (see
// scripts/check-controls.mjs), accessibility-minded React rules. shared/design-system is generated
// (scripts/design-system.mjs of the build framework): type-checked, not linted.
import eslintjs from "@eslint/js";
import microsoftPowerApps from "@microsoft/eslint-plugin-power-apps";
import pluginPromise from "eslint-plugin-promise";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["**/generated", "shared/design-system/**", "**/out/**", "**/node_modules/**", "**/obj/**", "**/bin/**", "scripts/**", "*.config.mts", "eslint.config.mjs"],
  },
  eslintjs.configs.recommended,
  ...typescriptEslint.configs.recommendedTypeChecked,
  ...typescriptEslint.configs.stylisticTypeChecked,
  pluginPromise.configs["flat/recommended"],
  microsoftPowerApps.configs.paCheckerHosted,
  reactPlugin.configs.flat.recommended,
  {
    plugins: {
      "@microsoft/power-apps": microsoftPowerApps,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ComponentFramework: true,
      },
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "no-restricted-globals": ["error", "fetch", "XMLHttpRequest", "WebSocket", "EventSource"],
      "no-restricted-properties": [
        "error",
        { object: "navigator", property: "sendBeacon", message: "No calls outside the platform unless declared in the manifest and approved." },
        { object: "window", property: "fetch", message: "Use context.webAPI; external calls need external-service-usage and an owner decision." },
        { object: "localStorage", message: "Do not keep personal data in browser storage." },
        { object: "sessionStorage", message: "Do not keep personal data in browser storage." },
      ],
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "error",
      "react/no-danger": "error",
      "@typescript-eslint/consistent-type-definitions": "off",
      // An empty string falling back to a default is intended (labels, titles): || stays allowed for strings.
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
    },
    settings: {
      react: {
        version: "16.14",
      },
    },
  },
  {
    files: ["shared/diagnostics.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tests/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
