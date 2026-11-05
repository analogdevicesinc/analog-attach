import { Bits, CellArrayElement, DTCellArray } from "../syntax/index.js";
import { assert_never } from "../../assert_never.js";

type TagWith<T extends string | bigint, TAG extends "number" | "label" | "path" | "expression"> = {
    _tag: TAG,
    value: T
}

export type NumberRepr = "dec" | "hex";

/** One cell of a `<…>` array, as `PropertyBuilder.number` / `label` / `path` / `expression` make it. */
export type CellValue =
    (TagWith<bigint, "number"> & { repr?: NumberRepr }) |
    TagWith<string, "label"> |
    TagWith<string, "path"> |
    TagWith<string, "expression">

/** A cell as the builder takes it: a number, written in decimal, or a tagged cell. */
export type CellInput = bigint | number | CellValue;

function cell_element(cell: CellInput): CellArrayElement {
    if (typeof cell !== "object") {
        return { kind: "number", value: BigInt(cell), labels: [], repr: "dec" };
    }
    switch (cell._tag) {
        case "number": {
            return { kind: "number", value: cell.value, labels: [], repr: cell.repr ?? "dec" };
        }
        case "label": {
            return { kind: "label", labels: [], name: cell.value };
        }
        case "path": {
            return { kind: "path", labels: [], path: cell.value };
        }
        case "expression": {
            return { kind: "expression", labels: [], value: cell.value };
        }
        default: {
            return assert_never(cell);
        }
    }
}

/** A `<…>` cell array of `bit_width`-bit cells (`/bits/ 64 <…>`; 32, dtc's default, is written without). */
export function make_cell_array(cells: CellInput[], bit_width: Bits = Bits.b32): DTCellArray {
    return { kind: "array", labels: [], bit_width, elements: cells.map((cell) => cell_element(cell)) };
}
