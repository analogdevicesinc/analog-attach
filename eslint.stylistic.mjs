// @stylistic/eslint-plugin's rules as this repository formats its code: the package configs
// (packages/*/eslint.config.mjs) add `stylistic_config` to their configs. Each rule is set to how
// the code is written (tabs, and `;` between type members, as decided for every package), and is
// an error, so the pre-commit hook (scripts/git-hooks/pre-commit) stops a commit that breaks it. All of them but max-len fix
// themselves: `yarn eslint --fix <file>` in the package.
//
// Left out: no-tabs (indent checks the indentation, and tabs in a template literal are content),
// object-curly-spacing and array-bracket-spacing (deprecated in @stylistic 6, they warn
// on every run), and the rules the code doesn't follow one way (padding lines, line breaks inside
// objects, arrays and calls).

import stylistic from "@stylistic/eslint-plugin";

/**
 * The plugin and its rules, the same in every package: tabs, and `;` after the members of an
 * interface or a type literal.
 */
export const stylistic_config = {
	plugins: { "@stylistic": stylistic },
	rules: {
		"@stylistic/indent": ["error", "tab"],
		"@stylistic/no-mixed-spaces-and-tabs": "error",
		"@stylistic/no-trailing-spaces": "error",
		"@stylistic/eol-last": "error",
		"@stylistic/linebreak-style": "error",
		"@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
		"@stylistic/max-len": ["error", { code: 180, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }],
		"@stylistic/operator-linebreak": ["error", "before"],

		"@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
		"@stylistic/quote-props": ["error", "as-needed"],
		"@stylistic/semi": "error",
		"@stylistic/no-extra-semi": "error",
		"@stylistic/comma-dangle": ["error", "only-multiline"],
		"@stylistic/member-delimiter-style": ["error", {
			multiline: { delimiter: "semi", requireLast: true },
			singleline: { delimiter: "semi", requireLast: false },
		}],
		"@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
		"@stylistic/arrow-parens": ["error", "as-needed"],
		"@stylistic/new-parens": "error",
		"@stylistic/no-floating-decimal": "error",
		"@stylistic/wrap-iife": "error",
		"@stylistic/dot-location": "error",

		"@stylistic/no-multi-spaces": ["error", { ignoreEOLComments: true }],
		"@stylistic/semi-spacing": "error",
		"@stylistic/comma-spacing": "error",
		"@stylistic/keyword-spacing": "error",
		"@stylistic/key-spacing": "error",
		"@stylistic/space-infix-ops": "error",
		"@stylistic/space-unary-ops": "error",
		"@stylistic/space-before-blocks": "error",
		"@stylistic/space-in-parens": "error",
		"@stylistic/space-before-function-paren": ["error", { anonymous: "always", named: "never", asyncArrow: "always" }],
		"@stylistic/function-call-spacing": "error",
		"@stylistic/arrow-spacing": "error",
		"@stylistic/block-spacing": "error",
		"@stylistic/computed-property-spacing": "error",
		"@stylistic/rest-spread-spacing": "error",
		"@stylistic/template-curly-spacing": "error",
		"@stylistic/switch-colon-spacing": "error",
		"@stylistic/no-whitespace-before-property": "error",
		"@stylistic/generator-star-spacing": ["error", { before: false, after: true }],
		"@stylistic/yield-star-spacing": "error",
		"@stylistic/type-annotation-spacing": "error",
		"@stylistic/type-generic-spacing": "error",
		"@stylistic/type-named-tuple-spacing": "error",
		"@stylistic/spaced-comment": "error",
	},
};
