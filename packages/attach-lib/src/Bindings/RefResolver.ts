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
                if (path.basename(file_path) === "types.yaml") { return tag_types(content); }
                return SELF_REFERENCE.test(content.toString("utf8")) ? drop_self_references(content) : content;
            } catch {
                throw new ResolverError(`Error opening file "${file_path}"`);
            }
        },
    };
}

const SELF_REFERENCE = /\$ref:\s*['"]?#/;

/**
 * The file with the `$ref`s that point at a schema they are inside of removed (`i2c-controller.yaml`'s
 * `i2c-bus` is `$ref: '#'`: a bus node within a bus node). Such a reference has no finite expansion, and
 * ref-parser, which can't dereference it, leaves every reference to a file that holds one unresolved.
 * The node keeps the keywords next to the `$ref` and accepts nothing more than they say.
 */
function drop_self_references(content: Buffer): Buffer {
    const document = parse(content.toString("utf8")) as unknown;

    const walk = (node: unknown, location: string[]): void => {
        if (typeof node !== "object" || node === null) { return; }
        const reference = (node as Record<string, unknown>).$ref;

        if (typeof reference === "string" && reference.startsWith("#")) {
            const target = reference.slice(1).split("/").slice(1).map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
            if (target.every((token, index) => location[index] === token)) {
                delete (node as Record<string, unknown>).$ref;
            }
        }

        for (const [key, value] of Object.entries(node)) { walk(value, [...location, key]); }
    };
    walk(document, []);

    return Buffer.from(JSON.stringify(document));
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
