import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import * as os from "node:os";
import path from "node:path";
import { load_property_types, PropertyTypes } from "./PropertyTypes.js";

/** The two checkouts the binding schemas are read from. A leading `~` is expanded. */
export type SchemaPaths = {
    linux: string;
    dt_schema: string;
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
    return directory.startsWith("~") ? directory.replace("~", os.homedir()) : directory;
}

export function create_context(paths: SchemaPaths): SchemaContext {
    return {
        parser: new $RefParser(),
        search_paths: [
            { prefix: "/schemas", dir: path.join(expand_home(paths.linux), "Documentation/devicetree/bindings") },
            { prefix: "/schemas", dir: path.join(expand_home(paths.dt_schema), "dtschema/schemas") },
        ],
        property_types: load_property_types(expand_home(paths.dt_schema)),
    };
}
