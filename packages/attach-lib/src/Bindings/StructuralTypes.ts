import { ResolvedProperty } from "./ParsedBinding";

export enum AttachEnumType {
    PHANDLE = "phandle",
    MACRO = "macro",
    STRING = "string",
    NUMBER = "number",
}

/** One option of an enum: a number, a string, or (compatible fallbacks like `["adi,adxl346", "adi,adxl345"]`) a whole list of strings. */
export type EnumOption = bigint | string | string[];

/** One value of a property: a single cell or string. */
export type Cell =
    | { _t: "number"; minimum?: bigint; maximum?: bigint; default?: bigint }
    | { _t: "enum"; enum: EnumOption[]; enum_type: AttachEnumType; default?: bigint | string }
    | { _t: "string" }
    /** A number, a label or a macro expression. */
    | { _t: "any" };

/** Values of one kind (`item` a single cell) or of fixed positions (`item` one cell per position). */
export type List = {
    _t: "list";
    item: Cell | Cell[];
    minItems?: number;
    maxItems?: number;
    typeSize?: number;
    unique?: boolean;
};

export type AttachType = { description?: string } & (
    | { _t: "flag" }
    | { _t: "scalar"; cell: Cell; default?: bigint | string; typeSize?: number }
    | List
    | { _t: "matrix"; rows: List[]; minItems?: number; maxItems?: number }
    | { _t: "node"; properties: ResolvedProperty[] }
    | { _t: "unknown" }
);

type Variant<T extends AttachType["_t"]> = Extract<AttachType, { _t: T }>;

export function is_list(type: AttachType): type is Variant<"list"> {
    return type._t === "list";
}

/**
 * A list of values nothing is known about but what a cell holds: the shape of an untyped array, or of one whose every
 * value is a whole `uint32` (reg.yaml's `reg` and interrupts.yaml's `interrupts`, `uint32-matrix` rows).
 */
export function is_open_list(type: AttachType): type is Variant<"list"> {
    if (type._t !== "list" || Array.isArray(type.item)) { return false; }
    const cell = type.item;
    return cell._t === "any" || (cell._t === "number" && cell.minimum === 0n && cell.maximum === 0xFF_FF_FF_FFn && cell.default === undefined);
}

/** A property the binding says nothing about but how many values it has: an open list, or a matrix of open lists. */
export function is_open(type: AttachType): boolean {
    return is_open_list(type) || (type._t === "matrix" && type.rows.length > 0 && type.rows.every(row => is_open_list(row)));
}

/** The cell of a list's single `item`, undefined for one cell per position. */
export function list_cell(list: List): Cell | undefined {
    return Array.isArray(list.item) ? undefined : list.item;
}

/** The cell of a matrix of one row of one cell (a `-microvolt` property), undefined for any other matrix. */
export function matrix_cell(matrix: Variant<"matrix">): Cell | undefined {
    const [row, ...others] = matrix.rows;
    if (matrix.maxItems !== 1 || row === undefined || others.length > 0 || row.maxItems !== 1) { return undefined; }
    return list_cell(row);
}
