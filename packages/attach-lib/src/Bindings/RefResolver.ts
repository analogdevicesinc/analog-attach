/* eslint-disable unicorn/prevent-abbreviations */
import { FileInfo, JSONSchema, ResolverError } from "@apidevtools/json-schema-ref-parser";
import { Result } from "../result.js";
import { SchemaContext, SearchPath } from "./Context.js";
import { DtBindingSchema, isDtBindingSchema } from "./Schema.js";
import { RefResolvedBinding } from "./UtilityTypes.js";

import * as fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * The keyword that tells what a schema's `$ref` to `types.yaml` was (`uint32-matrix`, `phandle-array`, `string`, ...).
 * dt-schema keeps the `$ref`s and reads a property's type from them (`validator.py:_extract_prop_type`); we
 * dereference, so `schema_resolver` tags each definition of `types.yaml` with it and the tag comes along.
 */
export const DT_TYPE = "dtType";

export async function resolve_references(
    source_path: string,
    ctx: SchemaContext,
): Promise<Result<RefResolvedBinding, string>> {

    const binding = await dereference(ctx, source_path);

    if (Result.is_err(binding)) {
        return Result.Err(binding.error);
    }

    const references: DtBindingSchema[] = [];

    for (const item of Object.keys(ctx.parser.$refs._$refs)) {
        const value = ctx.parser.$refs._$refs[item].value;
        if (isDtBindingSchema(value)) {
            references.push(value);
        }
    }

    return Result.Ok({ root_binding: binding.value as DtBindingSchema, refs: references });
}

/** Replaces every `$ref` of `source` (a path or a schema) with its target. Fails on circular references. */
export function dereference(ctx: SchemaContext, source: string | JSONSchema): Promise<Result<JSONSchema, string>> {
    return run(() => ctx.parser.dereference(source, {
        resolve: { my: schema_resolver(ctx.search_paths) },
        dereference: {
            circular: false,
            mergeKeys: false,
        },
    }));
}

/** Like `dereference`, but circular references stay as `$ref`s. */
export function bundle(ctx: SchemaContext, source: string | JSONSchema): Promise<Result<JSONSchema, string>> {
    return run(() => ctx.parser.bundle(source, {
        resolve: { my: schema_resolver(ctx.search_paths) },
    }));
}

async function run(resolve: () => Promise<JSONSchema>): Promise<Result<JSONSchema, string>> {
    try {
        return Result.Ok(await resolve());
    } catch (error) {
        return Result.Err(error instanceof Error ? error.message : "Failed to resolve");
    }
}

function is_readable(file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

// https://apidevtools.com/json-schema-ref-parser/docs/plugins/resolvers.html
function schema_resolver(search_paths: SearchPath[]) {
    return {
        order: 1,
        canRead(file: FileInfo) {
            return search_paths.some(({ prefix }) => file.url.startsWith(prefix));
        },

        read(file: FileInfo): Buffer {
            const candidates = search_paths
                .filter(({ prefix }) => file.url.startsWith(prefix))
                .map(({ prefix, dir }) => path.join(dir, file.url.slice(prefix.length)));

            const file_path = is_readable(file.url)
                ? file.url
                : (candidates.find(candidate => is_readable(candidate)) ?? candidates.at(-1) ?? file.url);

            try {
                const content = fs.readFileSync(file_path);
                return path.basename(file_path) === "types.yaml" ? tag_types(content) : content;
            } catch {
                throw new ResolverError(`Error opening file "${file_path}"`);
            }
        },
    };
}

/** `types.yaml` with every definition carrying its own name under `DT_TYPE`. */
function tag_types(content: Buffer): Buffer {
    const document = parse(content.toString("utf8")) as { definitions?: Record<string, unknown> };

    for (const [name, definition] of Object.entries(document.definitions ?? {})) {
        if (typeof definition === "object" && definition !== null) {
            (definition as Record<string, unknown>)[DT_TYPE] = name;
        }
    }

    // JSON is YAML, so the parser plugin reads it back as it would the original
    return Buffer.from(JSON.stringify(document));
}
