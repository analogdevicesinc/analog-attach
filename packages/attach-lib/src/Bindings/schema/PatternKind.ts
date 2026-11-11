import { Schema } from "./Schema.js";
/**
 * Whether a patternProperties entry describes child nodes: an object schema (inline, or in a oneOf / anyOf / allOf /
 * then / else). Anything else (a type, an enum, a description, true) names properties, whatever the pattern: an `@`
 * in it decides nothing (`^x,gain@[0-9]$: {$ref: uint32}` names properties).
 */
export function is_node_pattern(_pattern: string, schema: unknown): boolean {
    return is_object_schema(schema);
}

/**
 * Whether a schema describes a node: an object schema, inline or in a `oneOf` / `anyOf` / `allOf` / `then` / `else`.
 * `required` is a node's too: a property's value is never an object, so a branch that only requires properties of a
 * child node (adi,pulsar's `^channel@([0-8])$: {required: [adi,single-channel]}`) refines a node.
 */
export function is_object_schema(schema: unknown): boolean {
    if (typeof schema !== 'object' || schema === null) {
        return false;
    }
    const object = schema as Schema;
    if (object["type"] === "object" || "properties" in object || "patternProperties" in object || "required" in object) {
        return true;
    }
    for (const key of ["oneOf", "anyOf", "allOf"]) {
        const branches = object[key];
        if (Array.isArray(branches) && branches.some(branch => is_object_schema(branch))) {
            return true;
        }
    }
    return is_object_schema(object["then"]) || is_object_schema(object["else"]);
}
