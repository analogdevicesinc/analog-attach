// eslint-plugin-unicorn's rules as this repository uses them, on top of its `recommended` config:
// the package configs (packages/*/eslint.config.mjs) and the root one spread `unicorn_rules` into
// their `rules`.
//
// unicorn 61 to 79 added many rules to `recommended`, and made some older ones stricter. The new
// rules that go against how this code is written, or that are wrong for it, are off here; any
// other new rule stays on, so it checks new code. The rules unicorn 60 already had stay on.

/** unicorn 79's rules that are off here, each with why. */
const off = {
	// How the code is written: its /** */ doc comments with a `*` per line, if/else rather than
	// ternaries, `...(x ? { key } : {})` spreads, booleans named for what they mean.
	"single-line-block-comment-style": "the doc comments' style",
	"no-asterisk-prefix-in-documentation-comments": "the doc comments' style",
	"prefer-ternary": "if/else is the code's style",
	"consistent-conditional-object-spread": "the optional-field spreads' style",
	"consistent-boolean-name": "booleans are named for what they mean, not is_/has_",
	// Wrong for this code: dt-schema's `$id`s are http URLs, which must match as written; `{dtbo}` and
	// `node{nr}` are placeholders and devicetree syntax, not template slips; the default sort is the
	// order wanted for the strings sorted here; isSafeInteger would change what reaches BigInt().
	"prefer-https": "dt-schema's $id and $schema URLs are http",
	"no-incorrect-template-string-interpolation": "{placeholder} text is meant literally",
	"require-array-sort-compare": "only strings are sorted without a compare, in their default order",
	"prefer-number-is-safe-integer": "Number.isInteger guards BigInt(), which takes any integer",
	// unicorn 60's rules that 79 made stricter in a way that changes style, not catches more: it
	// would rewrite code that passed (separators in fraction digits, String.raw, flipped
	// conditions, template indentation, parameter defaults).
	"numeric-separators-style": "stricter in 79: a style change",
	"prefer-string-raw": "stricter in 79: a style change",
	"no-negated-condition": "stricter in 79: a style change",
	"template-indent": "stricter in 79: a style change",
	"prefer-default-parameters": "stricter in 79: a style change",
	// Style preferences new since unicorn 61, against the code's way of writing loops, conditions,
	// classes and iterations.
	"class-reference-in-static-methods": "style",
	"consistent-class-member-order": "style",
	"max-nested-calls": "style",
	"no-array-sort": "style: sort() on fresh arrays",
	"no-break-in-nested-loop": "style",
	"no-computed-property-existence-check": "style",
	"no-declarations-before-early-exit": "style",
	"no-duplicate-loops": "style",
	"no-immediate-mutation": "style",
	"no-negated-array-predicate": "style",
	"no-top-level-assignment-in-function": "style",
	"no-unnecessary-array-flat-map": "style",
	"no-unnecessary-boolean-comparison": "style",
	"no-unnecessary-nested-ternary": "style",
	"no-unnecessary-parameters": "style",
	"no-unreadable-for-of-expression": "style",
	"no-unreadable-object-destructuring": "style",
	"no-useless-collection-argument": "style",
	"no-useless-continue": "style",
	"no-useless-else": "style",
	"no-useless-iterator-to-array": "style",
	"no-useless-recursion": "style",
	"no-useless-template-literals": "style",
	"operator-assignment": "style",
	"prefer-array-from-map": "style",
	"prefer-await": "style",
	"prefer-boolean-return": "style",
	"prefer-combined-guards": "style",
	"prefer-continue": "style",
	"prefer-direct-iteration": "style",
	"prefer-early-return": "style",
	"prefer-else-if": "style",
	"prefer-global-number-constants": "style",
	"prefer-hoisting-branch-code": "style",
	"prefer-includes-over-repeated-comparisons": "style",
	"prefer-iterator-helpers": "style",
	"prefer-iterator-to-array": "style",
	"prefer-iterator-to-array-at-end": "style",
	"prefer-minimal-ternary": "style",
	"prefer-number-coercion": "style",
	"prefer-object-iterable-methods": "style",
	"prefer-promise-with-resolvers": "style",
	"prefer-set-methods": "style",
	"prefer-short-escape-sequences": "style",
	"prefer-simple-condition-first": "style",
	"prefer-simplified-conditions": "style",
	"prefer-smaller-scope": "style",
	"prefer-split-limit": "style",
	"prefer-string-repeat": "style",
	"prefer-then-catch": "style",
	"prefer-type-literal-last": "style",
	"prefer-unicode-code-point-escapes": "style",
};

export const unicorn_rules = {
	...Object.fromEntries(Object.keys(off).map(rule => [`unicorn/${rule}`, "off"])),
	// Was prevent-abbreviations. The code's names stay: `ctx`, and words its new defaults would
	// rename wrongly (i2c to index2c, application to app) or that the code uses on purpose.
	"unicorn/name-replacements": ["error", {
		allowList: { ctx: true },
		replacements: { i: false, application: false, configuration: false, deps: false, expr: false, ident: false, ref: false, repo: false },
	}],
};
