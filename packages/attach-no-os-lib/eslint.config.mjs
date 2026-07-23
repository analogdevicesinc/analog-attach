import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginUnicorn from "eslint-plugin-unicorn";

// Tier 3 (experimental): full type-aware linting scoped to this package only.
// strictTypeChecked  -> correctness/bug rules (async misuse, unsafe `any`,
//                       no-unnecessary-condition, no-unnecessary-type-assertion, ...)
// stylisticTypeChecked -> consistency rules that also need type info.
// Tune or drop rules in the final block as we see how noisy it is.
export default defineConfig([
	{
		// Only lint source; tests are not part of this package's tsconfig.
		files: ["src/**/*.ts"],
	},
	globalIgnores(["dist/**", "out/**", "node_modules/**", "coverage/**"]),
	eslintPluginUnicorn.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				// Type-aware linting: load the nearest tsconfig for each file.
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// --- carried over from the repo-wide config ---
			"unicorn/empty-brace-spaces": "off",
			"unicorn/filename-case": "off",
			"@typescript-eslint/naming-convention": ["warn", {
				selector: "import",
				format: ["camelCase", "PascalCase"],
			}],
			curly: "warn",
			eqeqeq: "warn",
			"no-throw-literal": "warn",
			semi: "warn",

			// --- Tier 1: the const/readonly intent rules ---
			"prefer-const": "warn",
			"no-param-reassign": ["warn", { props: true }],
			"@typescript-eslint/no-unused-vars": ["warn", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
			}],

			// --- Tier 3 extras (opinionated / strict) ---
			"@typescript-eslint/consistent-type-imports": "warn",
			// A `default` clause counts as handling the remaining union members, so
			// switches that intentionally catch-all aren't flagged. Switches WITHOUT a
			// default must still handle every case.
			"@typescript-eslint/switch-exhaustiveness-check": ["warn", {
				considerDefaultExhaustiveForUnions: true,
			}],
		},
	},
	{
		// workfile_handler is a deliberately mutate-in-place builder module: every CRUD
		// function mutates the passed `workfile` and returns it. That contract is
		// consistent within the module, so these two rules only produce noise here.
		files: ["src/workfile_handler/workfile_handler.ts"],
		rules: {
			"no-param-reassign": "off",
			"@typescript-eslint/no-dynamic-delete": "off",
		},
	},
	// Disabled for now: prefer-readonly-parameter-types is deep and noisy — every
	// object/array param flags, and satisfying it means threading DeepReadonly<T>
	// through every callee plus a cast at each structuredClone mutation boundary.
	// Revisit as a deliberate readonly pass. To re-enable, uncomment the block below.
	// {
	// 	files: ["src/validator/**/*.ts"],
	// 	rules: {
	// 		"@typescript-eslint/prefer-readonly-parameter-types": ["warn", {
	// 			ignoreInferredTypes: true,
	// 		}],
	// 	},
	// },
]);
