// Run by the CLI's vitest (packages/cli/vitest.config.ts takes the GUI's *.test.mjs): the GUI has
// no test runner of its own.
import { describe, expect, test } from "vitest";
import { shown_type } from "./dt-type.mjs";

describe("shown_type", () => {
	test("drops the counts of items, cells and rows (format_dt_type's count_text)", () => {
		expect(shown_type("uint64-array · 2 to 4 items")).toBe("uint64-array");
		expect(shown_type("uint32-array · 1 item")).toBe("uint32-array");
		expect(shown_type("uint32-array · 2 items")).toBe("uint32-array");
		expect(shown_type("uint32-array · at least 2 items")).toBe("uint32-array");
		expect(shown_type("string-array · 2 items")).toBe("string-array");
		expect(shown_type("uint8-array · 3 cells")).toBe("uint8-array");
		expect(shown_type("uint8-array · 1 cell")).toBe("uint8-array");
	});

	test("drops a matrix's shape (matrix_text, row_cells_text)", () => {
		expect(shown_type("phandle-array · 1 row of 3 cells")).toBe("phandle-array");
		expect(shown_type("phandle-array · 1 row")).toBe("phandle-array");
		expect(shown_type("phandle-array · 1 row of 1 to 8 cells")).toBe("phandle-array");
		expect(shown_type("phandle-array · 1 row of at least 2 cells")).toBe("phandle-array");
		expect(shown_type("phandle-array · 1 to 4 rows")).toBe("phandle-array");
		expect(shown_type("phandle-array · at least 2 rows")).toBe("phandle-array");
		expect(shown_type("uint32-matrix · rows of 2 cells")).toBe("uint32-matrix");
		expect(shown_type("uint64-matrix · 3 to 64 rows of 2 cells")).toBe("uint64-matrix");
		expect(shown_type("uint32-matrix · 2 rows of 1 to 3 cells")).toBe("uint32-matrix");
	});

	test("drops an enum's count, of the value or of each item (cell_text, list_text)", () => {
		expect(shown_type("uint32 · one of 3")).toBe("uint32");
		expect(shown_type("string · one of 3")).toBe("string");
		expect(shown_type("uint32-array · 1 item · one of 4")).toBe("uint32-array");
		expect(shown_type("uint32-array · 2 items · each one of 3")).toBe("uint32-array");
		expect(shown_type("string-array · each one of 12")).toBe("string-array");
	});

	test("keeps the ranges and consts", () => {
		expect(shown_type("uint32 · 0 to 10000000")).toBe("uint32 · 0 to 10000000");
		expect(shown_type("int32 · -5 to 5")).toBe("int32 · -5 to 5");
		expect(shown_type("uint32-array · 1 item · 0 to 15")).toBe("uint32-array · 0 to 15");
		expect(shown_type("uint32-array · 2 items · each 0 to 29")).toBe("uint32-array · each 0 to 29");
		expect(shown_type("address · 1 row of 1 cell · 0 to 15")).toBe("address · 0 to 15");
		expect(shown_type("uint32 · const 28")).toBe("uint32 · const 28");
		expect(shown_type("string-array · 1 item · const \"mclk\"")).toBe("string-array · const \"mclk\"");
		expect(shown_type("uint32-array · 2 items · each const 7")).toBe("uint32-array · each const 7");
		expect(shown_type("address · 1 row of 1 cell · const 3")).toBe("address · const 3");
		expect(shown_type("string-array · const \"a\", \"b\"")).toBe("string-array · const \"a\", \"b\"");
		// a const whose text reads like a size is still a const
		expect(shown_type("string · const \"2 items\"")).toBe("string · const \"2 items\"");
	});

	test("keeps a type with nothing after it", () => {
		for (const type of ["uint32", "flag", "node", "phandle", "untyped", "uint32-array | string-array"]) {
			expect(shown_type(type)).toBe(type);
		}
	});
});
