import * as vscode from "vscode";
import * as fs from 'node:fs';
import path = require("node:path");
import {
    expand_tilde_if_present,
    get_directory_md5_sync,
    CompatibleMapping,
    get_compatible_mapping,
    write_compatible_mappings_to_file,
    read_compatible_mappings_from_file,
    ProgressCallback
} from "../utilities";
import { AnalogAttachLogger } from "../AnalogAttachLogger";

/**
 * Manages schema caching and indexing for device tree bindings.
 * This class handles the shared logic for caching Linux kernel bindings and dt-schema files.
 */
export class SchemaCache {
    private readonly storage_path: string;
    private readonly global_state: vscode.Memento;

    private readonly linux_path: string;
    private readonly dt_schema_path: string;

    constructor(storage_path: string, linux_path: string, dt_schema_path: string, global_state: vscode.Memento) {
        this.storage_path = storage_path;
        this.linux_path = linux_path;
        this.dt_schema_path = dt_schema_path;
        this.global_state = global_state;
    }

    private async updateCache(linux_bindings_folder: string, dt_schema_schemas_path: string, compatible_mapping_path: string) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analog Attach",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "Indexing device tree bindings..." });
            await new Promise(resolve => setImmediate(resolve));

            await this.updateSchemaCache(
                linux_bindings_folder,
                dt_schema_schemas_path,
                compatible_mapping_path,
                (message) => {
                    progress.report({ message });
                }
            );

            progress.report({ message: "Computing checksums..." });
            await new Promise(resolve => setImmediate(resolve));
        });
    }

    /**
     * Ensures schemas are cached and up-to-date.
     * Returns the compatible mappings for the cached schemas.
     */
    public async ensureSchemasAreCached(linux_bindings_folder: string): Promise<CompatibleMapping[]> {
        const dt_schema_schemas_path = expand_tilde_if_present(path.join(this.dt_schema_path, "dtschema", "schemas"));

        if (!fs.existsSync(dt_schema_schemas_path)) {
            throw new Error(`${dt_schema_schemas_path} does not exist!`);
        }

        const compatible_mapping_path = path.join(this.storage_path, "compatible_mapping.txt");

        // Check if schemas need to be updated
        const stored_linux_bindings_md5 = this.global_state.get<string>("linux_bindings_md5");
        const stored_global_storage_md5 = this.global_state.get<string>("global_storage_md5");

        // On fresh install, skip expensive MD5 check - we know we need to index
        const is_fresh_install = !stored_linux_bindings_md5 || !stored_global_storage_md5;

        if (is_fresh_install) {
            AnalogAttachLogger.info("Fresh install detected, starting initial index!");

            await this.updateCache(linux_bindings_folder, dt_schema_schemas_path, compatible_mapping_path);
            const current_linux_bindings_md5 = get_directory_md5_sync(linux_bindings_folder);
            await this.global_state.update("linux_bindings_md5", current_linux_bindings_md5);
            await this.global_state.update('global_storage_md5', get_directory_md5_sync(this.storage_path));
        } else {
            // For subsequent runs, check if bindings changed
            const current_linux_bindings_md5 = get_directory_md5_sync(linux_bindings_folder);
            const current_global_storage_md5 = get_directory_md5_sync(this.storage_path);

            if (stored_linux_bindings_md5 !== current_linux_bindings_md5 ||
                stored_global_storage_md5 !== current_global_storage_md5) {
                AnalogAttachLogger.info("Detected changes, started reindex!");

                await this.updateCache(linux_bindings_folder, dt_schema_schemas_path, compatible_mapping_path);
                await this.global_state.update("linux_bindings_md5", current_linux_bindings_md5);
                await this.global_state.update('global_storage_md5', get_directory_md5_sync(this.storage_path));
            }
        }

        return read_compatible_mappings_from_file(compatible_mapping_path);
    }

    /**
     * Updates the schema cache by copying bindings and generating compatible mappings.
     */
    private async updateSchemaCache(
        linux_bindings_folder: string,
        dt_schema_schemas_path: string,
        compatible_mapping_path: string,
        onProgress?: ProgressCallback
    ): Promise<void> {
        const storage_bindings_folder_path = path.join(this.storage_path, 'schemas');

        if (onProgress) {
            onProgress("Cleaning up existing schemas...");
            await new Promise(resolve => setImmediate(resolve));
        }

        // Clean up existing schemas
        if (fs.existsSync(storage_bindings_folder_path)) {
            fs.rmSync(storage_bindings_folder_path, { recursive: true, force: true });
        }

        if (!fs.existsSync(storage_bindings_folder_path)) {
            fs.mkdirSync(storage_bindings_folder_path);
        }

        if (onProgress) {
            onProgress("Copying Linux kernel bindings...");
            await new Promise(resolve => setImmediate(resolve));
        }

        // Copy Linux kernel bindings
        fs.cpSync(
            linux_bindings_folder,
            storage_bindings_folder_path,
            {
                recursive: true,
                force: true,
                filter: (source, _destination) => {
                    return fs.lstatSync(source).isDirectory() || source.endsWith(".yaml");
                }
            }
        );

        if (onProgress) {
            onProgress("Copying dt-schema schemas...");
            await new Promise(resolve => setImmediate(resolve));
        }

        // Copy dt-schema schemas
        fs.cpSync(
            dt_schema_schemas_path,
            storage_bindings_folder_path,
            {
                recursive: true,
                force: true,
                filter: (source, _destination) => {
                    return fs.lstatSync(source).isDirectory() || source.endsWith(".yaml");
                }
            }
        );

        // Generate and cache compatible mappings
        const compatible_mapping = await get_compatible_mapping(
            linux_bindings_folder,
            this.linux_path,
            this.dt_schema_path,
            onProgress
        );
        AnalogAttachLogger.debug("Compatible mapping:", compatible_mapping);
        write_compatible_mappings_to_file(compatible_mapping_path, compatible_mapping);
    }

    /**
     * Gets the list of subsystems from the Linux bindings folder.
     * Currently hardcoded to only return "iio" subsystem.
     */
    public getSubsystems(linux_bindings_folder: string): string[] {
        const bindings_content = fs.readdirSync(linux_bindings_folder, { withFileTypes: true });

        if (bindings_content.length === 0) {
            throw new Error(`Empty folder: ${linux_bindings_folder}`);
        }

        const subsystems: string[] = [];

        for (const entry of bindings_content) {
            if (entry.isDirectory() && entry.name === "iio") {
                const entry_path = path.join(linux_bindings_folder, entry.name);
                subsystems.push(entry_path);
            }
        }

        return subsystems;
    }
}
