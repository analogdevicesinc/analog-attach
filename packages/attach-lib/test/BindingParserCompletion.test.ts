import path from 'node:path';
import * as fs from 'node:fs';

import { Attach, bidirectional_custom_resolve, circular_custom_resolve, find_in_object, insert_known_structures, parse_dts, query_devicetree, } from 'attach-lib';
import { write_to_directory } from './testing_utils';
import $RefParser from '@apidevtools/json-schema-ref-parser';

import { describe, test } from 'vitest';

const run = true;

describe.runIf(run)('Completion suite', () => {

    test('All bindings', async function (context) {

        const linux_path = path.resolve(__dirname, 'linux');
        const dt_schema_path = path.resolve(__dirname, 'dt-schema');

        if (!fs.existsSync(linux_path) || !fs.existsSync(dt_schema_path)) {
            context.skip();
        }

        const walk_directory = async (directory: string, pred: (file: string) => Promise<undefined>) => {
            const directory_content = fs.readdirSync(directory, { withFileTypes: true });

            for (const entry of directory_content) {

                if (entry.isDirectory()) {
                    await walk_directory(path.resolve(directory, entry.name), pred);
                } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
                    await pred(path.resolve(directory, entry.name));
                }
            }
        };

        let binding_count = 0;
        let parsed_binding_count = 0;
        const failed_to_parse_bindings: string[] = [];

        await walk_directory(path.resolve(__dirname, 'linux/Documentation/devicetree/bindings'), async (file: string) => {
            binding_count++;

            const attach = Attach.new();

            const binding = await attach.parse_binding(file, linux_path, dt_schema_path);

            if (binding === undefined) {
                failed_to_parse_bindings.push(file);
                return;
            }

            parsed_binding_count++;
            return;
        });

        console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
        console.log(`Parsed ${parsed_binding_count} out of ${binding_count}`);
        write_to_directory(path.resolve(__dirname, "expected/cache"), "failed_to_parse_bindings", failed_to_parse_bindings);
        console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    }, 120_000);

    test('IIO parse and interpret for rpi-4-b', async function (context) {

        const linux_path = path.resolve(__dirname, 'linux');
        const dt_schema_path = path.resolve(__dirname, 'dt-schema');

        if (!fs.existsSync(linux_path) || !fs.existsSync(dt_schema_path)) {
            context.skip();
        }

        const walk_directory = async (directory: string, pred: (file: string) => Promise<undefined>) => {
            const directory_content = fs.readdirSync(directory, { withFileTypes: true });

            for (const entry of directory_content) {

                if (entry.isDirectory()) {
                    await walk_directory(path.resolve(directory, entry.name), pred);
                } else if (entry.isFile() && entry.name.endsWith(".yaml") && entry.parentPath.includes("iio")) {
                    await pred(path.resolve(directory, entry.name));
                }
            }
        };

        const dt_source_path = path.resolve(__dirname, 'dts_source/rpi.prepro.dts');
        const dt_source = fs.readFileSync(dt_source_path, 'utf8');
        const document = parse_dts(dt_source);

        let binding_count = 0;
        let parsed_binding_count = 0;
        let no_generics = 0;
        let no_generics_no_generic_arrays = 0;
        const failed_to_parse_bindings: string[] = [];
        const generics_and_files: { generic_property: string, file: string }[] = [];
        const generic_arrays_and_files: { generic_array: string, file: string }[] = [];

        await walk_directory(path.resolve(__dirname, 'linux/Documentation/devicetree/bindings'), async (file: string) => {
            binding_count++;

            const attach = Attach.new();

            const binding = await attach.parse_binding(file, linux_path, dt_schema_path);

            if (binding === undefined) {
                failed_to_parse_bindings.push(file);
                return;
            }

            parsed_binding_count++;


            const data = {
            };

            binding.parsed_binding.properties = query_devicetree(document, binding.parsed_binding.properties, JSON.stringify(data), "spi@7e204000");
            binding.parsed_binding.properties = insert_known_structures(binding.parsed_binding.properties);

            if (binding.parsed_binding.pattern_properties !== undefined) {
                for (const pattern of binding.parsed_binding.pattern_properties) {
                    pattern.properties = query_devicetree(document, pattern.properties, JSON.stringify(data), "spi@7e204000");
                    pattern.properties = insert_known_structures(pattern.properties);
                }
            }

            const no_generic_property = (() => {
                let returnValue = true;

                for (const property of binding.parsed_binding.properties) {
                    if (property.value._t === 'generic') {
                        returnValue = false;
                        generics_and_files.push({ generic_property: property.key, file: file });
                    }
                }

                if (binding.parsed_binding.pattern_properties === undefined) {
                    return returnValue;
                }

                for (const pattern of binding.parsed_binding.pattern_properties) {
                    for (const property of pattern.properties) {
                        if (property.value._t === 'generic') {
                            returnValue = false;
                            generics_and_files.push({ generic_property: property.key, file: file });
                        }
                    }
                }

                return returnValue;
            })();

            const no_generic_array = (() => {
                let returnValue = true;

                for (const property of binding.parsed_binding.properties) {
                    if (property.value._t === 'array') {
                        returnValue = false;
                        generic_arrays_and_files.push({ generic_array: property.key, file: file });
                    }
                }

                if (binding.parsed_binding.pattern_properties === undefined) {
                    return returnValue;
                }

                for (const pattern of binding.parsed_binding.pattern_properties) {
                    for (const property of pattern.properties) {
                        if (property.value._t === 'array') {
                            returnValue = false;
                            generic_arrays_and_files.push({ generic_array: property.key, file: file });
                        }
                    }
                }

                return returnValue;
            })();

            if (no_generic_property) {
                no_generics++;
                if (no_generic_array) {
                    no_generics_no_generic_arrays++;
                }
            }

            return;
        });

        console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
        console.log(`Parsed ${parsed_binding_count} out of ${binding_count}`);
        console.log(`No generics in ${no_generics} out of ${binding_count}`);
        console.log(`No generics and no generic arrays in ${no_generics_no_generic_arrays} out of ${binding_count}`);
        write_to_directory(path.resolve(__dirname, "expected/cache"), "failed_to_parse_bindings_iio", failed_to_parse_bindings);
        write_to_directory(path.resolve(__dirname, "expected/cache"), "generics_and_files", generics_and_files);
        write_to_directory(path.resolve(__dirname, "expected/cache"), "generic_arrays_and_files", generic_arrays_and_files);
        console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    }, 120_000);

    test('select', async function (context) {

        const binding_folder_path = path.resolve(__dirname, 'linux/Documentation/devicetree/bindings/iio');
        const dt_schema_folder_path = path.resolve(__dirname, 'dt-schema/dtschema');
        const dt_schema_schemas_folder_path = path.resolve(__dirname, 'dt-schema/dtschema/schemas');

        if (!fs.existsSync(binding_folder_path) || !fs.existsSync(dt_schema_schemas_folder_path)) {
            context.skip();
        }

        const walk_directory = async (directory: string, pred: (file: string) => Promise<undefined>) => {
            const directory_content = fs.readdirSync(directory, { withFileTypes: true });

            for (const entry of directory_content) {

                if (entry.isDirectory()) {
                    await walk_directory(path.resolve(directory, entry.name), pred);
                } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
                    await pred(path.resolve(directory, entry.name));
                }
            }
        };

        await walk_directory(dt_schema_schemas_folder_path, async (file: string) => {

            const reference_parser = new $RefParser;

            const content = await circular_custom_resolve(reference_parser, file, dt_schema_folder_path);

            if (typeof content === "string") {
                console.log(`${content}`);
                return;
            }

            const select = find_in_object(content,
                (path: string[], value: unknown) => {
                    if (
                        path.at(0) === "select" &&
                        typeof value === 'boolean' &&
                        value === true
                    ) {
                        return true;
                    }
                    return false;
                }
            );

            if (select.length === 0) {
                return;
            }

            console.log(file);
        });


    }, 120_000);


    test('bidirectional resolver', async function (context) {

        const binding_folder_path = path.resolve(__dirname, 'linux');
        const dt_schema_folder_path = path.resolve(__dirname, 'dt-schema');

        if (!fs.existsSync(binding_folder_path) || !fs.existsSync(dt_schema_folder_path)) {
            context.skip();
        }

        const walk_directory = async (directory: string, pred: (file: string) => Promise<undefined>) => {
            const directory_content = fs.readdirSync(directory, { withFileTypes: true });

            for (const entry of directory_content) {

                if (entry.isDirectory()) {
                    await walk_directory(path.resolve(directory, entry.name), pred);
                } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
                    await pred(path.resolve(directory, entry.name));
                }
            }
        };

        const errors: [string, string][] = [];

        await walk_directory(path.resolve(__dirname, 'linux/Documentation/devicetree/bindings'), async (file: string) => {

            const reference_parser = new $RefParser;

            const content = await bidirectional_custom_resolve(reference_parser, file, binding_folder_path, dt_schema_folder_path);

            if (typeof content === "string") {
                errors.push([file, content]);
                return;
            }

            return;
        });

        for (const error of errors) {
            console.log(`${error[0]} error: ${error[1]}`);
        }

    }, 120_000);
});
