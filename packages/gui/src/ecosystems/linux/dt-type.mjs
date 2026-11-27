// A property's dt-schema type as the Linux part shows it (Preferences → Show property types): the
// CLI's `dt_type` (`format_dt_type`, packages/cli/src/backends/linux/protocol/binding-to-description.ts)
// without what it says of the value's size. Kept: the type and what each value can be.
//
//   uint32-array · 1 item · 0 to 15            uint32-array · 0 to 15
//   phandle-array · 1 row of 3 cells           phandle-array
//   string · one of 3                          string            (the dropdown has the options)
//   uint32-array · 2 items · each 0 to 29      uint32-array · each 0 to 29
//   string-array · 1 item · const "mclk"       string-array · const "mclk"
//
// The CLI's `dt_type` keeps every part: the skill reads the sizes. No DOM here, so its test runs in
// Node (dt-type.test.mjs, in the CLI's vitest).

/** How the CLI parts a `dt_type`. */
const SEPARATOR = " · ";

/** A count (count_text): `1`, `2 to 4`, `at least 2`. */
const COUNT = String.raw`(?:\d+ to \d+|at least \d+|\d+)`;

/**
 * A part about size: a count of items, cells or rows (`1 item`, `2 to 4 items`, `at least 2
 * items`, `3 cells`, `1 to 4 rows`), a matrix's shape (`1 row of 3 cells`, `rows of 2 cells`), or
 * an enum's count (`one of 3`, `each one of 3`), which the dropdown shows.
 */
const SIZE = new RegExp(String.raw`^(?:(?:${COUNT} (?:item|cell|row)s?|rows)(?: of ${COUNT} cells?)?|(?:each )?one of \d+)$`);

/**
 * `dt_type` without its parts about size: the type itself (`uint32`, `phandle-array`, `flag`,
 * `untyped`) stays, and so does a range (`0 to 15`, `each 0 to 7`) or a `const`.
 */
export function shown_type(dt_type) {
	const [type, ...constraints] = dt_type.split(SEPARATOR);
	return [type, ...constraints.filter(part => !SIZE.test(part))].join(SEPARATOR);
}
