/** A JSON schema object, or any object of a binding read as one (`properties`, a table of schemas by name). */
export type Schema = Record<string, unknown>;

/** A property's schema; `true` / `false` are schemas too, and are left alone. */
export type PropertySchema = Schema | boolean;

export function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `value` with `replace` applied to each entry of each object and array in it, top-down: `replace` gets the entry and
 * the keys down to it (`["allOf", "0", "then"]`), and what it returns is looked into in turn. `value` itself is left
 * as it is; an object or array something in changes is copied, the others are kept.
 */
export function map_entries<T>(value: T, replace: (entry: unknown, path: string[]) => unknown, path: string[] = []): T {
    const mapped = (entry: unknown, key: string): unknown => {
        const entry_path = [...path, key];
        return map_entries(replace(entry, entry_path), replace, entry_path);
    };

    if (Array.isArray(value)) {
        const entries = value.map((entry, index) => mapped(entry, String(index)));
        return (entries.some((entry, index) => entry !== value[index]) ? entries : value) as T;
    }
    if (!is_schema(value)) { return value; }

    let result: Schema | undefined;
    for (const [key, entry] of Object.entries(value)) {
        const after = mapped(entry, key);
        if (after !== entry) { (result ??= { ...value })[key] = after; }
    }
    return (result ?? value) as T;
}

/** Each entry of each object and array in `value`, depth first, with the keys down to it. */
export function* entries_of(value: unknown, path: string[] = []): Generator<[unknown, string[]]> {
    if (typeof value !== "object" || value === null) { return; }
    for (const [key, entry] of Object.entries(value)) {
        const entry_path = [...path, key];
        yield [entry, entry_path];
        yield* entries_of(entry, entry_path);
    }
}

/** What is at `path` in `value`, undefined if nothing is. */
export function value_at(value: unknown, path: string[]): unknown {
    let current = value;
    for (const key of path) {
        if (typeof current !== "object" || current === null || !(key in current)) { return undefined; }
        current = (current as Schema)[key];
    }
    return current;
}

/** `source` on top of `target`: objects are merged key by key, anything else (an array included) is `source`'s. */
export function deep_merge(target: unknown, source: unknown): unknown {
    if (!is_schema(target) || !is_schema(source)) { return source; }

    const result: Schema = { ...target };
    for (const [key, value] of Object.entries(source)) {
        result[key] = deep_merge(target[key], value);
    }
    return result;
}

export type DtBindingSchema = {
    $id: string,
    $schema: string,
    title: string,
    maintainers: string[],
    description?: string,
    select?: PropertySchema,
    allOf?: unknown[],
    anyOf?: unknown[],
    oneOf?: unknown[],
    properties?: Record<string, PropertySchema>,
    patternProperties?: Record<string, PropertySchema>,
    required?: string[],
    additionalProperties?: PropertySchema,
    unevaluatedProperties?: PropertySchema,
    examples?: string[],
};

/**
 * Whether `object` is a binding. Strictly, a schema needs only an `$id`, a `$schema`, a `title` and `maintainers`;
 * one with nothing more says nothing, but it is one.
 */
export function isDtBindingSchema(object: unknown): object is DtBindingSchema {
    return is_schema(object)
        && typeof object["$id"] === "string"
        && typeof object["$schema"] === "string"
        && typeof object["title"] === "string"
        && Array.isArray(object["maintainers"]);
}
