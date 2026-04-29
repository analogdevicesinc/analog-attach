export type DtBindingSchema = {
    $id: string,
    $schema: string,
    title: string,
    maintainers: string[],
    description?: string,
    select?: any,
    allOf?: any[],
    anyOf?: any[],
    oneOf?: any[],
    properties?: any,
    patternProperties?: any,
    required?: string[],
    additionalProperties?: boolean,
    unevaluatedProperties?: boolean,
    examples?: string[]
}

/*
    Strictly speaking a schema needs only id, schema, title and maintainers to be valid
    Such a schema does not provide any value, but it's the way it is
    There are more properties that can be added ... TBD 
*/
export function isDtBindingSchema(object: any): object is DtBindingSchema {
    const narrowed_object = object as DtBindingSchema;

    if (narrowed_object === null) { return false; }
    if (typeof narrowed_object !== "object") { return false; }
    if (typeof narrowed_object.$id !== "string") { return false; }
    if (typeof narrowed_object.$schema !== "string") { return false; }
    if (typeof narrowed_object.title !== "string") { return false; }
    if (!Array.isArray(narrowed_object.maintainers)) { return false; }

    return true;
}