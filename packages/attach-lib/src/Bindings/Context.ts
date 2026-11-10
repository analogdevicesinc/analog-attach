import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import * as os from "node:os";
import path from "node:path";
import { load_processed_property_types, load_property_types, PropertyTypes } from "./PropertyTypes.js";

/** The two checkouts the binding schemas are read from. A leading `~` is expanded. */
export type SchemaPaths = {
    linux: string;
    dt_schema: string;
    /**
     * The output of `dt-mk-schema -j` over the two checkouts: the property types of all their schemas by name. They
     * come on top of the ones dt-schema's own schemas declare, which are all that's known without it.
     */
    processed_schema?: string;
};

/** `$ref`s starting with `prefix` are read from `dir`, with the prefix removed (like dt-schema's `DTSchema.paths`). */
export type SearchPath = {
    prefix: string;
    dir: string;
};

/** A `$RefParser` and the places its `/schemas/...` references are looked up. One per binding: the parser keeps the files it read. */
export type SchemaContext = {
    parser: $RefParser;
    search_paths: SearchPath[];
    /** What dt-schema declares the type of properties to be, by name. */
    property_types: PropertyTypes;
};

function expand_home(directory: string): string {
    return directory.startsWith("~") ? directory.replace("~", () => os.homedir()) : directory;
}

function property_types(paths: SchemaPaths): PropertyTypes {
    const own = load_property_types(expand_home(paths.dt_schema));
    return paths.processed_schema === undefined ? own : load_processed_property_types(expand_home(paths.processed_schema), own);
}

/** The Linux tree's bindings directory (`Documentation/devicetree/bindings`). */
export function bindings_directory(paths: SchemaPaths): string {
    return path.join(expand_home(paths.linux), "Documentation/devicetree/bindings");
}

/**
 * The base of the schemas' `$id`s. ref-parser resolves a `$ref` against the `$id` of the schema it is in, so
 * `/schemas/types.yaml` in a binding whose `$id` is `http://devicetree.org/schemas/...` is asked for under this
 * URL; dt-schema reads it from the checkouts as well, never from the network.
 */
const SCHEMAS_URL = "http://devicetree.org/schemas";

export function create_context(paths: SchemaPaths): SchemaContext {
    const directories = [bindings_directory(paths), path.join(expand_home(paths.dt_schema), "dtschema/schemas")];
    return {
        parser: new $RefParser(),
        search_paths: [SCHEMAS_URL, "/schemas"].flatMap(prefix => directories.map(directory => ({ prefix, dir: directory }))),
        property_types: property_types(paths),
    };
}
