type Schema = Record<string, unknown>;

/**
 * Where the `$ref` of a schema that says more than its `$ref` waits while ref-parser dereferences it
 * (`stash_references`), to be merged with the schema after (`restore_references`).
 */
export const STASHED_REF = "$stashed-ref";

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Moves each `$ref` of `document` that has keywords beside it under `STASHED_REF`, alone: `{$ref: X, maximum: 6}`
 * becomes `{maximum: 6, $stashed-ref: {$ref: X}}`. ref-parser gets a `$ref` with keywords beside it wrong twice:
 * - it caches a `$ref` with nothing beside it and builds a later one to the same target from that cache, the
 *   target's keywords winning then (`{$ref: uint32, maximum: 6}` took the full range of `uint32`), the ones it adds
 *   never dereferenced;
 * - the target's own `$ref`s are resolved from the file of the schema that refers to it (`types.yaml`'s `phandle`
 *   refers to `#/definitions/phandle-array`).
 * A `$ref` alone it gets right, and the keywords are dereferenced as those of any schema.
 */
export function stash_references(document: unknown): void {
    if (Array.isArray(document)) {
        for (const entry of document) { stash_references(entry); }
        return;
    }
    if (!is_schema(document)) { return; }

    for (const value of Object.values(document)) { stash_references(value); }

    const reference = document["$ref"];
    if (typeof reference !== "string" || Object.keys(document).length === 1) { return; }

    delete document["$ref"];
    document[STASHED_REF] = { $ref: reference };
}

/**
 * Two tables of `properties` / `patternProperties`, merged by name. Only the names of `own` when it is `closed`:
 * `additionalProperties: false` beside a `$ref` allows the names its schema lists and no other the target does.
 */
function merge_named(base: Schema, own: Schema, closed: boolean): Schema {
    const merged: Schema = closed ? {} : { ...base };
    for (const [name, schema] of Object.entries(own)) {
        merged[name] = name in base ? merge_schema(base[name], schema) : schema;
    }
    return merged;
}

/**
 * `own` on top of `base`, both applying to the same value as dt-schema checks them. The keywords of `own` win,
 * except the ones that describe parts of the value, which are merged with those of `base`: `items`
 * (`{$ref: uint32-array, items: {default: 0}}` keeps the `uint32` items), the properties of a node by name
 * (`{$ref: video-interfaces.yaml#, properties: {bus-width}}` keeps `remote-endpoint`, unless `additionalProperties:
 * false` closes the node to the names it lists), and `required` joined. A `const` of `own` is the one value of an
 * `enum` of `base` too (`reg-io-width: {const: 1}` over `{enum: [1, 4]}`).
 */
export function merge_schema(base: unknown, own: unknown): unknown {
    if (!is_schema(base) || !is_schema(own)) { return own; }

    const closed = own["additionalProperties"] === false;
    const merged: Schema = { ...base };
    if ("const" in own) { delete merged["enum"]; }

    for (const key of ["properties", "patternProperties"]) {
        const before = base[key];
        if (closed && is_schema(before) && !(key in own)) { merged[key] = {}; }
    }

    for (const [key, value] of Object.entries(own)) {
        const before = base[key];

        if (key === "items" && key in base) {
            merged[key] = merge_items(before, value);
        } else if ((key === "properties" || key === "patternProperties") && is_schema(before) && is_schema(value)) {
            merged[key] = merge_named(before, value, closed);
        } else if (key === "required" && Array.isArray(before) && Array.isArray(value)) {
            merged[key] = [...new Set([...before, ...value])];
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/** Two `items`: an object applies to every entry of a list, and two lists are merged entry by entry. */
function merge_items(base: unknown, own: unknown): unknown {
    if (Array.isArray(base) && Array.isArray(own)) {
        return [...own.map((entry, index) => index < base.length ? merge_schema(base[index], entry) : entry), ...base.slice(own.length)];
    }
    if (Array.isArray(own)) { return own.map(entry => merge_schema(base, entry)); }
    if (Array.isArray(base)) { return base.map(entry => merge_schema(entry, own)); }
    return merge_schema(base, own);
}

/**
 * Merges each schema `stash_references` took the `$ref` of with what the `$ref` became (`merge_schema`), the
 * schema's own keywords on top. The places that refer to a target share it: it is merged with its own `$ref` first,
 * in place, and otherwise never changed. A `$ref` that wasn't dereferenced goes back where it was.
 */
export function restore_references(document: unknown, seen = new WeakSet<object>()): void {
    if (typeof document !== "object" || document === null || seen.has(document)) { return; }
    seen.add(document);

    if (Array.isArray(document)) {
        for (const entry of document) { restore_references(entry, seen); }
        return;
    }

    const schema = document as Schema;
    for (const value of Object.values(schema)) { restore_references(value, seen); }

    if (!(STASHED_REF in schema)) { return; }

    const target = schema[STASHED_REF];
    delete schema[STASHED_REF];

    if (!is_schema(target)) { return; }
    if (typeof target["$ref"] === "string") {
        schema["$ref"] = target["$ref"];
        return;
    }

    const merged = merge_schema(target, { ...schema }) as Schema;
    for (const key of Object.keys(schema)) { delete schema[key]; }
    Object.assign(schema, merged);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    /** What ref-parser makes of a stashed schema: its `$ref` replaced with the target. */
    const dereferenced = (own: Schema, target: Schema) => {
        const schema: Schema = { ...own, [STASHED_REF]: target };
        restore_references(schema);
        return schema;
    };

    test("a $ref with keywords beside it is stashed, one alone is not; one never dereferenced goes back", () => {
        const document = { properties: { a: { $ref: "x", maximum: 6 }, b: { $ref: "x" } } };
        stash_references(document);
        expect(document).toStrictEqual({ properties: { a: { maximum: 6, [STASHED_REF]: { $ref: "x" } }, b: { $ref: "x" } } });

        restore_references(document);
        expect(document).toStrictEqual({ properties: { a: { maximum: 6, $ref: "x" }, b: { $ref: "x" } } });
    });

    test("a schema's own keywords win over its target's, and its items are merged into the target's", () => {
        const uint32 = { type: "integer", minimum: 0, maximum: 9 };
        const target = { type: "array", minItems: 1, items: uint32 };

        expect(dereferenced({ minItems: 8, items: { default: 0 } }, target)).toStrictEqual({ type: "array", minItems: 8, items: { ...uint32, default: 0 } });
        expect(dereferenced({ items: [{ maximum: 1 }, { description: "b" }] }, target)).toStrictEqual({
            type: "array", minItems: 1, items: [{ ...uint32, maximum: 1 }, { ...uint32, description: "b" }],
        });
        expect(target).toStrictEqual({ type: "array", minItems: 1, items: uint32 });
        expect(uint32).toStrictEqual({ type: "integer", minimum: 0, maximum: 9 });
        // a const is the one value of the target's enum
        expect(merge_schema({ type: "integer", enum: [1, 4] }, { const: 1 })).toStrictEqual({ type: "integer", const: 1 });
    });

    test("a node's own properties are merged by name with its target's, and required joined", () => {
        const target = { type: "object", properties: { reg: { maxItems: 1 }, "bus-width": { maximum: 32 } }, required: ["reg"] };
        expect(dereferenced({ properties: { "bus-width": { enum: [8, 16] } }, required: ["bus-width"] }, target)).toStrictEqual({
            type: "object",
            properties: { reg: { maxItems: 1 }, "bus-width": { maximum: 32, enum: [8, 16] } },
            required: ["reg", "bus-width"],
        });
    });

    test("a node closed with additionalProperties: false keeps only its own names, merged with the target's", () => {
        const target = { type: "object", properties: { reg: { maxItems: 1 }, bipolar: { type: "boolean" } }, patternProperties: { "^x-": {} } };
        expect(dereferenced({ properties: { reg: { description: "r" } }, additionalProperties: false }, target)).toStrictEqual({
            type: "object",
            properties: { reg: { maxItems: 1, description: "r" } },
            patternProperties: {},
            additionalProperties: false,
        });
    });

    test("two lists of items merge entry by entry, the longer one's rest kept", () => {
        expect(dereferenced({ items: [{ c: 1 }] }, { items: [{ a: 1 }, { b: 1 }] })).toStrictEqual({ items: [{ a: 1, c: 1 }, { b: 1 }] });
    });

    test("a $ref to a schema that has one: the target merged with its own first, the schema's keywords on top", () => {
        // `{$ref: phandle, description}`, `phandle` being `{$ref: phandle-array, maxItems: 1, items: {maxItems: 1}}`
        const phandle_array = { type: "array", minItems: 1, items: { type: "array", maxItems: 1024 } };
        const phandle = { maxItems: 1, items: { maxItems: 1 }, [STASHED_REF]: phandle_array };

        expect(dereferenced({ description: "d" }, phandle)).toStrictEqual({ type: "array", minItems: 1, items: { type: "array", maxItems: 1 }, maxItems: 1, description: "d" });
        expect(phandle_array.items.maxItems).toBe(1024);
    });
}
