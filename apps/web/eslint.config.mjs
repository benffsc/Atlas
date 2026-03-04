import nextConfig from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nextConfig,
  ...coreWebVitals,
  {
    rules: {
      // Warn on console.log (keep console.error/warn for legitimate logging)
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Allow explicit any as warning (too many to fix immediately)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused vars with underscore prefix
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Downgrade to warnings — too many to fix at once
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-children-prop": "warn",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "e2e/**",
    ],
  },
];
