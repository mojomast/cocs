import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated and runtime output that is not linted:
    "game/**/*.test.mjs",
    ".sites-runtime/**",
    ".wrangler/**",
    "dist/**",
    "coverage/**",
  ]),
  {
    files: ["game/**/*.mjs"],
    rules: {
      // The game engine is plain JavaScript, not React. This rule is also
      // pathologically slow on large modules (game/race.mjs), blocking lint.
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      // The single-page client intentionally uses untyped interop at the
      // game-engine boundary; these are tracked as warnings so lint can gate
      // real errors without a 185-error baseline.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-assign-module-variable": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
