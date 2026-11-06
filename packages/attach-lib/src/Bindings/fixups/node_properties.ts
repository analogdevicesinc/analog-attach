import { NodeFixup } from "./Walker.js";
import { Schema } from "../schema/Schema.js";

/** Conditions only match: what the fixup adds to a node must not become something they require. */
const CONDITION_KEYS = new Set(["if", "not", "select"]);

const PINCTRL = /^pinctrl-[0-9]/;

/** Whether an `allOf` entry of `schema` (a `$ref`'d schema, at any depth, not an `if`) names `name`. */
function named_in_entries(schema: Schema, name: string): boolean {
    const entries = Array.isArray(schema["allOf"]) ? schema["allOf"] as unknown[] : [];
    return entries.some(entry => typeof entry === "object" && entry !== null && !("if" in entry)
        && (Object.hasOwn((entry as Schema)["properties"] ?? {}, name) || named_in_entries(entry as Schema, name)));
}

/**
 * dt-schema: `fixups.py:fixup_node_props`. A node that forbids the properties it doesn't name
 * (`additionalProperties` / `unevaluatedProperties` other than `true`) still has `status`, and `pinctrl-names` and
 * `pinctrl-N` unless it names a `pinctrl-N` itself. They are `true`, as dt-schema adds them: the `selected` stage types
 * them from dt-core.yaml and pinctrl-consumer.yaml. Not a `pinctrl-names` an `allOf` entry names (chipidea,usb2-common.yaml's
 * 1 to 3 names): a `true` says nothing next to it in dt-schema, and the typed one would hide it here.
 *
 * Not ported: `phandle`, `secure-status` and the `bootph-*`, which every such node would show as its properties, nor
 * `assigned-clocks` (with `clocks`) and `dma-ranges` (with `ranges`).
 */
export const fixup_node_properties: NodeFixup = (schema, path) => {
    if (path.some(key => CONDITION_KEYS.has(key))) { return; }
    if (!("additionalProperties" in schema) && !("unevaluatedProperties" in schema)) { return; }
    if (schema["additionalProperties"] === true || schema["unevaluatedProperties"] === true) { return; }

    const properties = (schema["properties"] ??= {}) as Schema;
    properties["status"] ??= true;
    const patterns = schema["patternProperties"] as Schema | undefined;
    if ([...Object.keys(properties), ...Object.keys(patterns ?? {})].some(key => PINCTRL.test(key))) { return; }

    if (!named_in_entries(schema, "pinctrl-names")) { properties["pinctrl-names"] ??= true; }
    schema["patternProperties"] = { "^pinctrl-[0-9]+$": true, ...patterns };
};

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixup = (schema: Schema, path: string[] = []) => {
        fixup_node_properties(schema, path);
        return schema;
    };

    test("a node that forbids other properties gets pinctrl-names and pinctrl-N", () => {
        expect(fixup({ properties: { reg: true }, unevaluatedProperties: false })).toStrictEqual({
            properties: { reg: true, status: true, "pinctrl-names": true },
            patternProperties: { "^pinctrl-[0-9]+$": true },
            unevaluatedProperties: false,
        });
        expect(fixup({ patternProperties: { "^channel@[0-9]$": { type: "object" } }, additionalProperties: false })).toStrictEqual({
            properties: { status: true, "pinctrl-names": true },
            patternProperties: { "^channel@[0-9]$": { type: "object" }, "^pinctrl-[0-9]+$": true },
            additionalProperties: false,
        });
    });

    test("a node that names a pinctrl-N gets only status; one that allows any property or says nothing of them is left alone, and so is a condition", () => {
        expect(fixup({ properties: { "pinctrl-0": true }, additionalProperties: false }))
            .toStrictEqual({ properties: { "pinctrl-0": true, status: true }, additionalProperties: false });
        const own_status = { properties: { status: { const: "okay" } }, additionalProperties: false };
        expect(fixup(structuredClone(own_status)).properties).toStrictEqual({ status: { const: "okay" }, "pinctrl-names": true });
        expect(fixup({ properties: { reg: true }, additionalProperties: true })).toStrictEqual({ properties: { reg: true }, additionalProperties: true });
        expect(fixup({ properties: { reg: true } })).toStrictEqual({ properties: { reg: true } });
        expect(fixup({ properties: { reg: true }, additionalProperties: false }, ["allOf", "0", "if"]))
            .toStrictEqual({ properties: { reg: true }, additionalProperties: false });
    });

    test("a pinctrl-names an allOf entry names gets no placeholder, the pattern still is added", () => {
        const common = { properties: { "pinctrl-names": { oneOf: [{ items: [{ const: "default" }] }] } } };
        expect(fixup({ allOf: [{ allOf: [common] }], unevaluatedProperties: false })).toStrictEqual({
            allOf: [{ allOf: [common] }],
            properties: { status: true },
            patternProperties: { "^pinctrl-[0-9]+$": true },
            unevaluatedProperties: false,
        });
    });
}
