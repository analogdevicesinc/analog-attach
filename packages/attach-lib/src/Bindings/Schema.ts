/** A JSON schema object, or any object of a binding read as one (`properties`, a table of schemas by name). */
export type Schema = Record<string, unknown>;

/** A property's schema; `true` / `false` are schemas too, and are left alone. */
export type PropertySchema = Schema | boolean;

export function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
