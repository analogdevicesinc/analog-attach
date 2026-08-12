import { Bits, CellArrayElement, DTCellArray } from "./parser";
import { Labeled, MakeArray, is_array, is_labeled, make_array, make_labeled } from "./TypeUtilities";

type DTString = string;
type DTString_Array = MakeArray<DTString>;
export type LabeledDTString = Labeled<DTString>;
type LabeledDTString_Array = MakeArray<LabeledDTString>;
export type DTStringInput = (DTString | DTString_Array | LabeledDTString | LabeledDTString_Array);

function is_dt_string(object: any): object is DTString {
    if (object === null || typeof object !== 'string') {
        return false;
    }

    return true;
}

function is_dts_string_array(object: any): object is DTString_Array {
    return is_array(object) && object.every((entry) => is_dt_string(entry));
}

function is_labeled_dt_string(object: any): object is LabeledDTString {
    return is_labeled(object) && is_dt_string(object.payload);
}

function is_labeled_dt_string_array(object: any): object is LabeledDTString_Array {
    return is_array(object) && object.every((entry) => is_labeled_dt_string(entry));
}

function is_dt_string_input(object: any): object is DTStringInput {
    return is_dt_string(object) ||
        is_dts_string_array(object) ||
        is_labeled_dt_string(object) ||
        is_labeled_dt_string_array(object);
}

export function upcast_to_LabeledDTStringArray(input: DTStringInput): LabeledDTString_Array {
    if (is_dt_string(input)) {
        return make_array(make_labeled(input));
    }

    if (is_dts_string_array(input)) {
        return input.map((entry) => make_labeled(entry));
    }

    if (is_labeled_dt_string(input)) {
        return make_array(input);
    }

    return input;
}

export type DTSReferenceInput = DTString | LabeledDTString;

function is_dts_reference_input(object: any): object is DTSReferenceInput {
    return is_dt_string(object) || is_labeled_dt_string(object);
}

export function upcast_to_LabeledDTString(input: DTSReferenceInput): LabeledDTString {

    if (is_dt_string(input)) {
        return make_labeled(input);
    }

    return input;
}

const CELL_VALUE_TAGS = ["number", "label", "path", "expression"] as const;
type CellValueTag = typeof CELL_VALUE_TAGS[number];

type TagWith<T extends string | bigint, TAG extends CellValueTag> = {
    _tag: TAG,
    value: T
}

function is_tagged(object: any): object is TagWith<string | bigint, CellValueTag> {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    if (!("_tag" in object)) {
        return false;
    }

    if (!("value" in object)) {
        return false;
    }

    if (Object.entries(object).length > 2) {
        return false;
    }

    const narrowed = object as TagWith<string | bigint, CellValueTag>;

    if (!CELL_VALUE_TAGS.includes(narrowed._tag)) {
        return false;
    }

    if (!['string', 'bigint'].includes(typeof narrowed.value)) {
        return false;
    }

    return true;
}

export type CellValue =
    TagWith<bigint, "number"> |
    TagWith<string, "label"> |
    TagWith<string, "path"> |
    TagWith<string, "expression">

type TaggedCellValue_Array = MakeArray<CellValue>;
type TaggedCellValue_LabeledArray = Labeled<TaggedCellValue_Array>;

export type LabeledTaggedCellValue = Labeled<CellValue>;
type LabeledTaggedCellValue_Array = MakeArray<LabeledTaggedCellValue>;
type LabeledTaggedCellValue_LabeledArray = Labeled<LabeledTaggedCellValue_Array>;

export type CellEntry = CellValue | LabeledTaggedCellValue;
export type CellArray = TaggedCellValue_Array | TaggedCellValue_LabeledArray | LabeledTaggedCellValue_Array | LabeledTaggedCellValue_LabeledArray;
export type CellMatrix = MakeArray<CellArray>;
export type DTCellArrayInput = CellEntry | CellArray | CellMatrix;

function is_tagged_cell_value_array(object: any): object is TaggedCellValue_Array {
    return is_array(object) && object.every((entry) => is_tagged(entry) === true);
}

function is_tagged_cell_value_labeled_array(object: any): object is TaggedCellValue_LabeledArray {
    return is_labeled(object) && is_tagged_cell_value_array(object.payload);
}

function is_labeled_tagged_cell_value(object: any): object is LabeledTaggedCellValue {
    return is_labeled(object) && is_tagged(object.payload);
}

function is_labeled_tagged_cell_value_array(object: any): object is LabeledTaggedCellValue_Array {
    return is_array(object) && object.every((entry) => is_labeled_tagged_cell_value(entry) === true);
}

function is_labeled_tagged_cell_value_labeled_array(object: any): object is LabeledTaggedCellValue_LabeledArray {
    return is_labeled(object) && is_labeled_tagged_cell_value_array(object.payload);
}

function is_cell_entry(object: any): object is CellEntry {
    return is_tagged(object) || is_labeled_tagged_cell_value(object);
}

export function is_cell_array(object: any): object is CellArray {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    return is_tagged_cell_value_array(object) ||
        is_tagged_cell_value_labeled_array(object) ||
        is_labeled_tagged_cell_value_array(object) ||
        is_labeled_tagged_cell_value_labeled_array(object);
}

export function is_cell_matrix(object: any): object is CellMatrix {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    if (!is_array(object)) {
        return false;
    }

    if (!object.every((entry) => is_cell_array(entry) === true)) {
        return false;
    }

    return true;
}

export function is_cell_entry_or_cell_array(object: any): object is (CellEntry | CellArray) {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    return is_cell_entry(object) || is_cell_array(object);
}

export function is_cell_array_or_cell_matrix(object: any): object is (CellArray | CellMatrix) {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    return is_cell_array(object) || is_cell_matrix(object);
}

export function upcast_to_LabeledTaggedCellValue_LabeledArray(input: CellEntry | CellArray): LabeledTaggedCellValue_LabeledArray {

    if (is_tagged_cell_value_array(input)) {
        return make_labeled(input.map((entry) => make_labeled(entry)));
    }

    if (is_tagged_cell_value_labeled_array(input)) {
        return make_labeled(input.payload.map((entry) => make_labeled(entry)));
    }

    if (is_tagged(input)) {
        return make_labeled(make_array(make_labeled(input)));
    }

    if (is_labeled_tagged_cell_value_array(input)) {
        return make_labeled(input);
    }

    if (is_labeled_tagged_cell_value(input)) {
        return make_labeled(make_array(input));
    }

    return input;
}

export function make_cell_array(values: LabeledTaggedCellValue_LabeledArray): DTCellArray {

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const tagged_to_element = (entry: LabeledTaggedCellValue): CellArrayElement => {
        switch (entry.payload._tag) {
            case "number": {
                return {
                    kind: "number",
                    value: entry.payload.value,
                    labels: entry.labels,
                    repr: "dec"
                };
            }
            case "label": {
                return {
                    kind: "label",
                    labels: entry.labels,
                    name: entry.payload.value
                };
            }
            case "path": {
                return {
                    kind: "path",
                    labels: entry.labels,
                    path: entry.payload.value
                };
            }
            case "expression": {
                return {
                    kind: "expression", labels: entry.labels, value: entry.payload.value
                };
            }
            default: {
                const _x: never = entry.payload;
                throw new Error("Exhaustive check failed!");
            }
        }
    };

    return {
        kind: "array",
        labels: values.labels,
        bit_width: Bits.b32,
        elements: values.payload.map((v) => tagged_to_element(v)),
    };
}