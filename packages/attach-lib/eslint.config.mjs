import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import { unicorn_rules } from "../../eslint.unicorn.mjs";

export default [{
    files: ["**/*.ts"],
},
eslintPluginUnicorn.configs.recommended,
{
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        'unicorn/empty-brace-spaces': "off",
        'unicorn/filename-case': "off",
        // unicorn's rules as the repository uses them (eslint.unicorn.mjs).
        ...unicorn_rules,
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];