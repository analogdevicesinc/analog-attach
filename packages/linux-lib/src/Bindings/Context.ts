import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import * as os from "node:os";
import path from "node:path";
import { read_processed_schema } from "./schema/ProcessedSchema.js";
import { load_processed_property_types, load_property_types, PropertyTypes } from "./schema/PropertyTypes.js";
import type { PreparedSchemas } from "./Prepared.js";
import type { SelectedDefinitions } from "./stages/Selected.js";

/** The two checkouts the binding schemas are read from. A leading `~` is expanded. */
export type SchemaPaths = {
	linux: string;
	dt_schema: string;
	/**
	 * The output of `dt-mk-schema -j` over the two checkouts, or a part of it with its `generated-types`,
	 * `generated-pattern-types` and `select: true` schemas: the property types of all their schemas by name, which come
	 * on top of the ones dt-schema's own schemas declare (all that's known without it), and which schemas are
	 * `select: true` (without it, the checkouts are searched for them).
	 */
	processed_schema?: string;
	/**
	 * The prepared schemas of these paths, saved by the caller (`PreparedSchemas`): taken in place of the property types
	 * and the `select: true` definitions, which aren't read again. Saved by the same lib from the same paths, they give a
	 * binding what reading them would.
	 */
	prepared?: PreparedSchemas;
	/** Without `prepared`: called with the prepared schemas a parse has built, for the caller to save. */
	on_prepared?: (prepared: PreparedSchemas) => void;
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
	/**
	 * The schemas dt-validate applies to every node (`select: true`), by their path under the search paths' directories
	 * (`iio/iio.yaml`), from the processed schema; undefined without one.
	 */
	selected?: string[];
	/** The definitions of the `select: true` schemas, from `SchemaPaths.prepared`: `selected_definitions` reads none. */
	prepared_selected?: SelectedDefinitions;
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

/** The prefix of the schemas' `$ref`s within the checkouts (`/schemas/types.yaml`). */
export const SCHEMAS_PATH = "/schemas";

/** The `select: true` schemas of the processed schema, by their path under the schema directories. */
function selected_schemas(paths: SchemaPaths): string[] | undefined {
	const processed = paths.processed_schema === undefined ? undefined : read_processed_schema(expand_home(paths.processed_schema));
	return processed?.selected.filter(id => id.startsWith(`${SCHEMAS_URL}/`)).map(id => id.slice(SCHEMAS_URL.length + 1).replace(/#$/, ""));
}

export function create_context(paths: SchemaPaths): SchemaContext {
	const directories = [bindings_directory(paths), path.join(expand_home(paths.dt_schema), "dtschema/schemas")];
	const search_paths = [SCHEMAS_URL, SCHEMAS_PATH].flatMap(prefix => directories.map(directory => ({ prefix, dir: directory })));
	if (paths.prepared !== undefined) {
		return { parser: new $RefParser(), search_paths, property_types: paths.prepared.property_types, prepared_selected: paths.prepared.selected };
	}
	const selected = selected_schemas(paths);
	return {
		parser: new $RefParser(),
		search_paths,
		property_types: property_types(paths),
		...(selected === undefined ? {} : { selected }),
	};
}
