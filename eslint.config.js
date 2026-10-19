import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
 {files:["scripts/sync-lab/**/*.cjs"],languageOptions:{globals:globals.node,sourceType:"commonjs",ecmaVersion:2022},rules:{...pluginJs.configs.recommended.rules}},
 {files:["lab/c2-runtime/**/*.{js,mjs}"],languageOptions:{globals:{...globals.node,...globals.browser},ecmaVersion:2022,sourceType:"module"},rules:{...pluginJs.configs.recommended.rules,"no-unused-vars":["error",{argsIgnorePattern:"^_"}]}},
 {files:["desktop/setup-preload.cjs","desktop/recovery-preload.cjs","desktop/electron-builder-h.cjs","desktop/electron-builder-agente5.cjs","desktop/electron-builder-agente5-rc.cjs","desktop/electron-builder-agente5-rc2.cjs","desktop/electron-builder-agente5-rc3.cjs"],languageOptions:{globals:globals.node,sourceType:"commonjs",ecmaVersion:2022},rules:{...pluginJs.configs.recommended.rules}},
 {files:["desktop/setup-renderer.js","desktop/recovery-renderer.js"],languageOptions:{globals:globals.browser,ecmaVersion:2022},rules:{...pluginJs.configs.recommended.rules}},
 {ignores:["artifacts/**","dist-d1/**","desktop/node_modules/**"]},
 {files:["desktop/**/*.mjs","server/sync-lab/**/*.mjs","server/local-lab/**/*.mjs","scripts/sync-lab/**/*.mjs","scripts/sync-lab.mjs"],languageOptions:{globals:{...globals.node,...globals.browser},ecmaVersion:2022,sourceType:"module"},rules:{...pluginJs.configs.recommended.rules,"no-unused-vars":["error",{argsIgnorePattern:"^_"}]}},
 {files:["server/d1-lab/**/*.mjs","scripts/d1-lab/**/*.mjs","scripts/d1-lab.mjs","lab/d1/**/*.mjs"],languageOptions:{globals:{...globals.node,...globals.browser},ecmaVersion:2022,sourceType:"module"},rules:{...pluginJs.configs.recommended.rules,"no-unused-vars":["error",{argsIgnorePattern:"^_"}]}},
 {files:["lab/d1/**/*.jsx"],...pluginJs.configs.recommended,languageOptions:{globals:globals.browser,parserOptions:{ecmaVersion:2022,sourceType:"module",ecmaFeatures:{jsx:true}}},plugins:{react:pluginReact},rules:{"no-unused-vars":"off","react/jsx-uses-vars":"error"}},
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
