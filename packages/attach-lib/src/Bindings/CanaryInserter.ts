import { DtBindingSchema, is_schema, map_entries } from "./Schema.js";

/** Property name that makes an implicit `if/then` branch detectable by AJV; see `Attach.narrow`. Not for any other use. */
export const CANARY = "__canary__";

/** Each `then` / `else` of an `allOf` entry, at any depth, forbidding the `CANARY` property. */
export function insert_canaries(binding: DtBindingSchema): DtBindingSchema {
    return map_entries(binding, (entry, path) => {
        if (!["then", "else"].includes(path.at(-1) ?? "") || path.at(-3) !== "allOf") { return entry; }

        // A branch that is no object (`then: true`) says nothing but the canary
        if (!is_schema(entry)) { return { properties: { [CANARY]: false } }; }
        const properties = is_schema(entry["properties"]) ? entry["properties"] : {};
        return { ...entry, properties: { ...properties, [CANARY]: false } };
    });
}
