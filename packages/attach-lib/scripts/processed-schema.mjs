// The output of `dt-mk-schema -j` over a Linux tree (`make dt_binding_check` leaves it in the bindings directory):
// the property types of every schema, which the binding pipeline reads when it's given the file as `processed_schema`.
// PROCESSED_SCHEMA names another one; PROCESSED_SCHEMA= (empty) means none.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** The file to use for this Linux tree, or undefined when there is none. */
export function processed_schema_of(linux) {
  const file = process.env.PROCESSED_SCHEMA ?? join(linux, "Documentation/devicetree/bindings/processed-schema.json");
  return file !== "" && existsSync(file) ? resolve(file) : undefined;
}

/** `Attach.parse` paths for the trees, with the processed schema when there is one. */
export function schema_paths(linux, dt_schema) {
  const processed_schema = processed_schema_of(linux);
  return { linux, dt_schema, ...(processed_schema === undefined ? {} : { processed_schema }) };
}
