/* eslint-disable unicorn/prevent-abbreviations */

import { $RefParser, FileInfo, JSONSchema, ResolverError } from "@apidevtools/json-schema-ref-parser";
import { DtBindingSchema, isDtBindingSchema } from "../DtBindingSchema.js";
import { RefResolvedBinding } from './UtilityTypes.js';

import * as os from 'node:os';
import * as fs from 'node:fs';
import path from "node:path";

export async function resolve_references(
    source_path: string,
    parser: $RefParser,
    linux_path: string,
    dt_schema_path: string
): Promise<RefResolvedBinding | string> {

    const binding = await bidirectional_custom_resolve(parser, source_path, linux_path, dt_schema_path);

    if (typeof binding === "string") {
        return binding;
    }

    const references: DtBindingSchema[] = [];

    for (const item of Object.keys(parser.$refs._$refs)) {
        if (isDtBindingSchema(parser.$refs._$refs[item].value)) {
            references.push(parser.$refs._$refs[item].value as DtBindingSchema);
        }
    }

    return { root_binding: binding as DtBindingSchema, refs: references };
}

export async function custom_resolve(parser: $RefParser, source: any, custom_storage_path: string): Promise<JSONSchema | string> {
    try {
        const resolved = await parser.dereference(
            source,
            {
                resolve:
                {
                    my: custom_path_schema_resolver(custom_storage_path)
                },
                dereference:
                {
                    circular: false,
                    mergeKeys: false,
                }
            }
        );

        return resolved;
    } catch (error) {
        if (error instanceof Error) {
            return error.message;
        }

        return "Failed to resolve";
    }
}

export async function circular_custom_resolve(parser: $RefParser, source: any, custom_storage_path: string): Promise<JSONSchema | string> {
    try {
        const resolved = await parser.bundle(
            source,
            {
                resolve:
                {
                    my: custom_path_schema_resolver(custom_storage_path)
                }
            }
        );

        return resolved;
    } catch (error) {
        if (error instanceof Error) {
            return error.message;
        }

        return "Failed to resolve";
    }
}

function custom_path_schema_resolver(custom_path: string) {

    // https://apidevtools.com/json-schema-ref-parser/docs/plugins/resolvers.html
    return {
        order: 1,
        canRead: true,

        read(file: FileInfo): Buffer {
            let file_path = file.url;

            try {
                fs.accessSync(file_path, fs.constants.R_OK);
            }
            catch {
                file_path = custom_path.startsWith("~") ? path.join(custom_path.replace("~", os.homedir()), file.url) : path.join(custom_path, file.url);
            }

            try {
                return fs.readFileSync(file_path);
            } catch {
                throw new ResolverError(`Error opening file "${file_path}"`);
            }
        },
    };
}

export async function bidirectional_custom_resolve(parser: $RefParser, source: any, linux_path: string, dt_schema_path: string): Promise<JSONSchema | string> {

    try {
        const resolved = await parser.dereference(
            source,
            {
                resolve:
                {
                    my: bidirectional_custom_path_schema_resolver(
                        path.join(linux_path, 'Documentation/devicetree/bindings'),
                        path.join(dt_schema_path, 'dtschema')
                    )
                },
                dereference:
                {
                    circular: false,
                    mergeKeys: false,
                }
            }
        );

        return resolved;
    } catch (error) {
        if (error instanceof Error) {
            return error.message;
        }

        return "Failed to resolve";
    }
}

function bidirectional_custom_path_schema_resolver(linux_path: string, dt_schema_path: string) {

    // https://apidevtools.com/json-schema-ref-parser/docs/plugins/resolvers.html
    return {
        order: 1,
        canRead(file: FileInfo) {
            return file.url.startsWith('/schemas');
        },

        read(file: FileInfo): Buffer {
            let file_path = file.url;

            try {
                fs.accessSync(file_path, fs.constants.R_OK);
            }
            catch {

                try {
                    let temp_file_path = file_path.replace('/schemas', "");

                    temp_file_path = linux_path.startsWith("~") === true ?
                        path.join(linux_path.replace("~", os.homedir()), temp_file_path) :
                        path.join(linux_path, temp_file_path);

                    fs.accessSync(temp_file_path, fs.constants.R_OK);
                    file_path = temp_file_path;
                }
                catch {
                    file_path = dt_schema_path.startsWith("~") === true ?
                        path.join(dt_schema_path.replace("~", os.homedir()), file.url) :
                        path.join(dt_schema_path, file.url);
                }
            }

            try {
                return fs.readFileSync(file_path);
            } catch {
                throw new ResolverError(`Error opening file "${file_path}"`);
            }
        },
    };
}

