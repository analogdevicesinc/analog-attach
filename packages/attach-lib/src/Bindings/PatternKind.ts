/**
 * Whether a patternProperties entry describes child nodes: an object schema
 * (inline, or in a oneOf / anyOf / allOf / then / else), or a unit address in
 * the pattern. Anything else (a type, an enum, a description, true) names
 * properties.
 */
export function is_node_pattern(pattern: string, schema: unknown): boolean {
    if (pattern.includes("@")) {
        return true;
    }
    return is_object_schema(schema);
}

function is_object_schema(schema: unknown): boolean {
    if (typeof schema !== 'object' || schema === null) {
        return false;
    }
    const object = schema as Record<string, unknown>;
    if (object["type"] === "object" || "properties" in object || "patternProperties" in object) {
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
