import * as vscode from "vscode";
import * as fs from 'node:fs';

import path = require("node:path");

import {
    Attach,
    BindingErrors,
    DtsDocument,
    DtsNode,
    DtsProperty,
    DtsValue,
    DtsValueComponent,
    CellArrayElement,
    parseDtso,
    printDts,
    printDtso,
    parseDtsWithLabelMap,
    mergeDtso,
    markNodesModified,
    ParsedBinding
} from "attach-lib";
import {
    CompatibleMapping,
    bigIntReplacer
} from "../utilities";
import type { CatalogDevice, ConfigTemplatePayload, DeviceIdentifier, DeviceUID, FormElement } from "extension-protocol";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { SchemaCache } from "./SchemaCache";
import { UUID } from "node:crypto";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { expand_tilde_if_present } from "../utilities";
import { EXTENSION_ID } from "../constants";

const exec = promisify(execCallback);
const sanitizeDeviceNodeName = (value: string): string => value
    .toLowerCase()
    .replaceAll(/[^a-z0-9,._+-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");

/**
 * This function just checks that the file given contains
 * the preprocessing directives
 * @param file_contents The raw string read from the file
 * @returns true if it is preprocessed, false otherwise
 */
const isFilePreprocessed = (file_contents: string): boolean => {
    const checked_directives = ["include", "defined", "if", "ifdef", "ifndef", "pragma", "undef"];
    for (const directive of checked_directives) {
        if (file_contents.includes(`#${directive}`)) {
            return false;
        }
    }
    return true;
};

const quoteIfNeeded = (value: string): string => value.includes(" ") ? `"${value}"` : value;

const preprocessDtsIfNeeded = async (file_contents: string, file_path: string): Promise<string> => {
    if (isFilePreprocessed(file_contents)) {
        return file_contents;
    }

    const preprocess_command = vscode.workspace
        .getConfiguration('analog-attach')
        .get<string>('preprocessDtsFilesCommand');
    if (!preprocess_command) {
        vscode.window.showErrorMessage(
            "DTS file appears un-preprocessed and preprocess command is not set. Please configure analog-attach.preprocessDtsFilesCommand or preprocess manually."
        );
        throw new Error("DTS file contains preprocessing directives");
    }

    const default_linux_repo = vscode.workspace
        .getConfiguration('analog-attach')
        .get<string>('defaultLinuxRepository');
    let expanded_command = preprocess_command;

    if (expanded_command.includes("{include_dir_path}") || expanded_command.includes("{arch_dir_path}")) {
        if (!default_linux_repo) {
            vscode.window.showErrorMessage(
                "DTS preprocess command uses {include_dir_path}/{arch_dir_path} but analog-attach.defaultLinuxRepository is not set."
            );
            throw new Error("Missing Linux repository for preprocess command");
        }

        const linux_root = expand_tilde_if_present(default_linux_repo);
        const include_directory_path = quoteIfNeeded(path.join(linux_root, "include"));
        const arch_directory_path = quoteIfNeeded(path.join(linux_root, "arch"));
        expanded_command = expanded_command
            .replaceAll("{include_dir_path}", include_directory_path)
            .replaceAll("{arch_dir_path}", arch_directory_path);
    }

    const quotedPath = file_path.includes(" ")
        ? `"${file_path}"`
        : file_path;
    const composed_command = `${expanded_command} ${quotedPath}`;

    try {
        const { stdout } = await exec(composed_command);
        if (!stdout || stdout.trim().length === 0) {
            throw new Error("Preprocess command returned empty output.");
        }
        return stdout;
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to preprocess DTS. Update analog-attach.preprocessDtsFilesCommand or preprocess manually. Command: ${composed_command}`
        );
        throw error;
    }
};

/**
 * Ensure a DTSO overlay has the minimal scaffold so parsing/merging works even for empty files.
 */
const ensureDtsoScaffold = (text: string): { normalized: string; updated: boolean } => {
    const trimmed = text.trim();
    const defaultDtso = String.raw`/dts-v1/;
/plugin/;

/ {};`;

    if (trimmed.length === 0) {
        return { normalized: defaultDtso, updated: true };
    }

    let normalized = text;
    let updated = false;

    if (!/\/dts-v1\//.test(normalized)) {
        normalized = `/dts-v1/;\n${normalized}`;
        updated = true;
    }

    if (!/\/plugin\//.test(normalized)) {
        normalized = normalized.replace(/\/dts-v1\/;?/m, (match) => `${match}\n/plugin/;`) || `/dts-v1/;\n/plugin/;\n${normalized}`;
        updated = true;
    }

    if (!/^\s*\/\s*{/m.test(normalized)) {
        normalized = `${normalized}\n/ {\n};`;
        updated = true;
    }

    return { normalized, updated };
};

export class AttachSession {

    private readonly storage_path: string;
    private readonly file_uri: vscode.Uri | undefined;
    private readonly linux_bindings_folder: string;

    private readonly linux_path: string;
    private readonly dt_schema_path: string;

    private readonly subsystems: string[];
    private readonly compatible_mapping: CompatibleMapping[];

    private device_tree: DtsDocument;
    private label_map: Map<string, string>;
    private is_dtso_file: boolean = false;
    private original_dtso_content: string | undefined;
    private base_device_tree_path: string | undefined;
    private suppress_next_file_change_notification: boolean = false;

    /** Tracks the number of validation errors from the last UI validation pass */
    private last_validation_error_count: number = 0;

    // Logging configuration
    private readonly debug_enabled: boolean = false;

    private constructor(
        subsystems: string[],
        compatible_mapping: CompatibleMapping[],
        storage_path: string,
        device_tree: DtsDocument,
        linux_bindings_folder: string,
        linux_path: string,
        dt_schema_path: string,
        label_map: Map<string, string>,
        file_uri?: vscode.Uri
    ) {
        this.subsystems = subsystems;
        this.compatible_mapping = compatible_mapping;
        this.storage_path = storage_path;
        this.device_tree = device_tree;
        this.linux_bindings_folder = linux_bindings_folder;
        this.linux_path = linux_path;
        this.dt_schema_path = dt_schema_path;
        this.label_map = label_map;
        this.file_uri = file_uri;
    }

    public static createTestSession(
        subsystems: string[],
        compatible_mapping: CompatibleMapping[],
        storage_path: string,
        device_tree: DtsDocument,
        linux_bindings_folder: string,
        linux_path: string,
        dt_schema_path: string,
        label_map: Map<string, string>,
        file_uri?: vscode.Uri
    ): AttachSession {
        return new AttachSession(
            subsystems,
            compatible_mapping,
            storage_path,
            device_tree,
            linux_bindings_folder,
            linux_path,
            dt_schema_path,
            label_map,
            file_uri
        );
    }


    /**
     * Creates a new AttachSession instance for a specific file.
     */
    public static async createForFile(
        file_uri: vscode.Uri,
        linux_bindings_folder: string,
        linux_path: string,
        dt_schema_path: string,
        storage_path: string,
        global_state: vscode.Memento
    ): Promise<AttachSession> {

        // Create schema cache and ensure schemas are up-to-date
        const schema_cache = new SchemaCache(storage_path, linux_path, dt_schema_path, global_state);
        const compatible_mapping = await schema_cache.ensureSchemasAreCached(linux_bindings_folder);

        // Get subsystems
        const subsystems = schema_cache.getSubsystems(linux_bindings_folder);

        // Load the actual file content for this specific file
        let device_tree: DtsDocument;
        let label_map: Map<string, string> = new Map();
        let is_dtso = file_uri.fsPath.endsWith('.dtso');
        let original_dtso_content: string | undefined;

        try {
            if (fs.existsSync(file_uri.fsPath)) {
                let file_content_raw = fs.readFileSync(file_uri.fsPath, { encoding: "utf8" });
                file_content_raw = await preprocessDtsIfNeeded(file_content_raw, file_uri.fsPath);

                const { normalized: file_content, updated: _ } = is_dtso
                    ? ensureDtsoScaffold(file_content_raw)
                    : { normalized: file_content_raw, updated: false };

                if (is_dtso) {
                    // For DTSO files, store the original content
                    original_dtso_content = file_content;
                    // Parse the DTSO content directly to get the overlay nodes
                    const dtsoDocument = parseDtso(file_content);

                    // If there are unresolved overlays or the root has modifications,
                    // materialize the overlay against an empty base so nodes are visible
                    // before the user selects a base DTS.
                    if (dtsoDocument.unresolved_overlays && dtsoDocument.unresolved_overlays.length > 0) {
                        const emptyDts = String.raw`/dts-v1/;
/ {};`;
                        const emptyParse = parseDtsWithLabelMap(emptyDts, true);
                        device_tree = mergeDtso(emptyParse.document, file_content, true);
                        const mergedLabelMap = parseDtsWithLabelMap(printDts(device_tree), true);
                        label_map = mergedLabelMap.label_map;
                    } else {
                        // No unresolved overlays - use the parsed DTSO directly
                        device_tree = dtsoDocument;
                        // Mark all nodes as modified since they come from DTSO
                        markNodesModified(device_tree.root);
                        // Build label map
                        const parseResult = parseDtsWithLabelMap(printDts(device_tree), true);
                        label_map = parseResult.label_map;
                    }
                } else {
                    // Regular DTS files
                    const parseResult = parseDtsWithLabelMap(file_content, false);
                    device_tree = parseResult.document;
                    label_map = parseResult.label_map;
                }
            } else {
                // Create empty device tree for new files
                const emptyDts = file_uri.fsPath.endsWith('.dtso')
                    ? String.raw`/dts-v1/;
/plugin/;

/ {};`
                    : String.raw`/dts-v1/;
/ {};`;
                let parseResult: { document: DtsDocument; label_map: Map<string, string>; };
                if (is_dtso) {
                    parseResult = parseDtsWithLabelMap(emptyDts, true);
                    original_dtso_content = emptyDts;
                } else {
                    parseResult = parseDtsWithLabelMap(emptyDts, false);
                }

                device_tree = parseResult.document;
                label_map = parseResult.label_map;
            }
        } catch (error) {
            console.error(`Failed to parse device tree file ${file_uri.fsPath}:`, error);
            // Fallback to empty device tree
            const emptyDts = String.raw`/dts-v1/;
/ {};`;
            const parseResult = parseDtsWithLabelMap(emptyDts, false);
            device_tree = parseResult.document;
            label_map = parseResult.label_map;
        }

        const session = new AttachSession(
            subsystems,
            compatible_mapping,
            storage_path,
            device_tree,
            linux_bindings_folder,
            linux_path,
            dt_schema_path,
            label_map,
            file_uri
        );

        session.is_dtso_file = is_dtso;
        session.original_dtso_content = original_dtso_content;
        return session;
    }

    public get_subsystems(): string[] {
        return this.subsystems;
    }

    public get_device_tree(): DtsDocument {
        return this.device_tree;
    }

    /**
     * Get the label-to-path map for the device tree
     */
    public get_label_map(): Map<string, string> {
        return this.label_map;
    }

    /**
     * Build a lightweight catalog view of every compatible binding known to the
     * current session. The catalog data is derived from the compatible mapping
     * generated during schema caching.
     */
    public get_catalog_devices(): CatalogDevice[] {
        const catalog: CatalogDevice[] = [];
        const seen = new Set<string>();

        for (const mapping of this.compatible_mapping) {
            if (seen.has(mapping.compatible_string)) {
                continue;
            }
            seen.add(mapping.compatible_string);

            const group = this.deriveCatalogDeviceGroup(mapping.binding_path);
            if (group === undefined) {
                // The yaml file is either in the root or does not have a category
                // Anyway, it is considered invalid for this version
                continue;
            }

            catalog.push({
                deviceId: mapping.compatible_string,
                name: this.deriveCatalogDeviceName(mapping.compatible_string),
                description: "", // FIXME: Where exactly is the description, is it the title of the YAML?
                group: group,
            });
        }

        return catalog.sort((a, b) => a.name.localeCompare(b.name));
    }

    public async set_parent_node(deviceId: string, parentNodeId: UUID): Promise<DeviceUID> {

        const parentNode = this.find_node_by_uuid(parentNodeId);
        if (!parentNode) {
            throw new Error(`Parent node ${parentNodeId} not found in device tree`);
        }

        const includeUnitAddr = await this.deviceHasRegProperty(deviceId);
        const deviceNode = this.createMinimalDeviceNode(deviceId, parentNode, includeUnitAddr);
        parentNode.children.push(deviceNode);
        parentNode.modified_by_user = true;

        if (this.has_file_uri()) {
            await this.save_device_tree();
        }

        return deviceNode._uuid;
    }

    public move_device_node(deviceUID: DeviceUID, parentNodeUID: DeviceUID): DeviceUID {
        const currentParent = this.find_parent_node_by_uuid(deviceUID);
        if (!currentParent) {
            throw new Error(`Cannot find parent for node ${deviceUID}`);
        }

        const index = currentParent.children.findIndex((c) => c._uuid === deviceUID);
        if (index === -1) {
            throw new Error(`Node ${deviceUID} not found under its parent`);
        }
        const node = currentParent.children[index];

        const targetParent = this.find_node_by_uuid(parentNodeUID);
        if (!targetParent) {
            throw new Error(`Target parent ${parentNodeUID} not found`);
        }

        if (currentParent._uuid === targetParent._uuid) {
            return deviceUID;
        }

        if (this.isNodeWithinSubtree(node, targetParent)) {
            throw new Error(`Cannot move node ${deviceUID} under its own descendant`);
        }

        // actual move
        currentParent.children.splice(index, 1);
        targetParent.children.push(node);

        currentParent.modified_by_user = true;
        targetParent.modified_by_user = true;
        node.modified_by_user = true;

        // I don't think we need to generate a new UUID tbh
        return deviceUID;
    }

    /**
     * Create a deep copy of the current device tree and label map for rollback.
     */
    public create_restore_point(): { device_tree: DtsDocument; label_map: Map<string, string> } {
        return {
            device_tree: structuredClone(this.device_tree),
            label_map: structuredClone(this.label_map),
        };
    }

    /**
     * Restore the device tree and label map from a previously created restore point.
     */
    public restore_from_restore_point(restore_point: { device_tree: DtsDocument; label_map: Map<string, string> }): void {
        this.device_tree = structuredClone(restore_point.device_tree);
        this.label_map = structuredClone(restore_point.label_map);
    }

    /**
     * Validate that a move is possible without mutating the device tree.
     * Throws if the target parent is missing or would create an invalid structure.
     */
    public preflight_move_device_node(deviceUID: DeviceUID, parentNodeUID: DeviceUID): void {
        // No move will be done
        if (parentNodeUID === deviceUID) {
            return;
        }

        const target_parent_node = this.find_node_by_uuid(parentNodeUID);
        if (target_parent_node === undefined) {
            throw new Error(`Parent node with UUID ${parentNodeUID} not found in device tree`);
        }

        const node = this.find_node_by_uuid(deviceUID);
        if (node === undefined) {
            throw new Error(`Cannot find node by uuid: ${deviceUID}`);
        }

        if (this.isNodeWithinSubtree(node, target_parent_node)) {
            throw new Error(`Cannot move node ${deviceUID} under its own descendant`);
        }
    }

    private createMinimalDeviceNode(
        device_compatible: DeviceIdentifier,
        parentNode: DtsNode,
        includeUnitAddr: boolean
    ): DtsNode {
        const baseName = this.buildDeviceNodeBaseName(device_compatible);

        // FIXME: This is a failsafe so when adding 2 of the same compatibles
        // the default reg is not the same (idk if it is necessary, used to be)
        const unitAddr = includeUnitAddr ? this.allocateUnitAddress(parentNode, baseName) : undefined;
        let regProperty: DtsProperty | undefined = undefined;
        if (unitAddr !== undefined) {
            // FIXME: Should add the unitAddr as a reg property as well
            // but this is a very wrong way of adding it (hardcoded)
            regProperty = {
                name: "reg",
                labels: [],
                deleted: false,
                modified_by_user: true,
                value: {
                    components: [{
                        kind: "array",
                        labels: [],
                        elements: [
                            {
                                item: {
                                    kind: "number",
                                    value: BigInt(unitAddr),
                                    repr: "dec",
                                    labels: [],
                                },
                            },
                        ]
                    },
                    ],
                },
            };
        }
        const isKnownDevice = this.compatible_mapping.some((entry) => entry.compatible_string === device_compatible);

        const properties = [
            this.createStringProperty("status", "okay"),
        ];

        if (isKnownDevice) {
            properties.push(this.createStringProperty("compatible", device_compatible));
        }

        if (regProperty !== undefined) {
            properties.push(regProperty);
        }

        return {
            labels: [],
            name: baseName,
            unit_addr: unitAddr,
            properties: properties,
            _uuid: crypto.randomUUID(),
            children: [],
            deleted: false,
            modified_by_user: true,
            created_by_user: true,
        };
    }

    private async deviceHasRegProperty(compatible: string): Promise<boolean> {
        const mapping = this.compatible_mapping.find(
            (entry) => entry.compatible_string === compatible
        );
        if (!mapping) {
            return false;
        }

        try {
            const attach = Attach.new();
            const binding = await attach.parse_binding(mapping.binding_path, this.linux_path, this.dt_schema_path);
            if (!binding) {
                return false;
            }

            const parsed = binding.parsed_binding;
            if ((parsed.required_properties ?? []).includes("reg")) {
                return true;
            }

            return (parsed.properties ?? []).some((property) => property.key === "reg");
        } catch {
            return false;
        }
    }

    private buildDeviceNodeBaseName(deviceId: string): string {
        const [, suffix] = deviceId.split(",");
        const rawName = (suffix ?? deviceId).trim();
        const sanitized = sanitizeDeviceNodeName(rawName);

        if (sanitized.length > 0 && !/^[0-9]/.test(sanitized)) {
            return sanitized;
        }

        // If the suffix is numeric-only (e.g., pci168c,0023 -> 0023), prefer a dashed form to avoid numeric node names.
        const dashedFallback = sanitizeDeviceNodeName(deviceId.replace(",", "-"));
        if (dashedFallback.length > 0) {
            return dashedFallback;
        }

        return "device";
    }

    private allocateUnitAddress(parentNode: DtsNode, baseName: string): string {
        const existingSegments = new Set(parentNode.children.map((child) => this.buildNodeSegment(child)));
        let attempt = 0;
        while (true) {
            const candidateUnit = attempt.toString(16);
            const candidateSegment = `${baseName}@${candidateUnit}`;
            if (!existingSegments.has(candidateSegment)) {
                return candidateUnit;
            }
            attempt += 1;
        }
    }

    public buildNodeSegment(node: DtsNode): string {
        return node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
    }

    private createStringProperty(name: string, value: string): DtsProperty {
        return {
            name,
            value: {
                components: [
                    {
                        kind: "string",
                        value,
                        labels: [],
                    },
                ],
            },
            labels: [],
            deleted: false,
            modified_by_user: true,
        } as DtsProperty;
    }

    private deriveCatalogDeviceName(compatibleString: string): string {
        const [vendor, ...rest] = compatibleString.split(",");
        const suffix = rest.join(","); // doubt we'll have names with more than one comma
        if (vendor?.toLowerCase() === "adi" && suffix.length > 0) {
            return suffix.toUpperCase();
        }
        return compatibleString;
    }

    public async delete_device(deviceUID: DeviceUID): Promise<DeviceUID> {
        // Delete exactly the node referenced by the provided UID
        const parent_node = this.find_parent_node_by_uuid(deviceUID);
        if (parent_node === undefined) {
            throw new Error(`Cannot find parent with id: ${deviceUID}`);
        }

        const index = parent_node.children.findIndex((child) => child._uuid === deviceUID);
        parent_node.children.splice(index, 1);
        parent_node.modified_by_user = true;

        // Save changes to file if session has a file URI
        if (this.has_file_uri()) {
            await this.save_device_tree();
        }

        return deviceUID;
    }

    public async get_binding_for_compatible(compatibleString: string, data: string): Promise<{
        parsed_binding: ParsedBinding;
        errors: BindingErrors[];
        patterns: string[];
    } | undefined> {
        const mapping = this.compatible_mapping.find(
            (entry) => entry.compatible_string === compatibleString
        );
        if (!mapping) {
            return undefined;
        }

        return this.get_binding(mapping.binding_path, data);
    }

    /**
     * Resolve binding information and required keys for a device node.
     * Returns undefined when the compatible or binding cannot be resolved.
     */
    public async buildFormElementsForNode(node: DtsNode, data: string):
        Promise<
            {
                binding: ParsedBinding;
                requiredKeys: Set<string>;
                patterns: string[];
                errors: BindingErrors[];
            }
        > {

        let compatibleStrings: string[];
        try {
            compatibleStrings = this.getCompatibleStringsFromNode(node);
        } catch {
            // Treat nodes without a compatible as custom nodes: no binding lookup/validation
            return {
                binding: { required_properties: [], properties: [], examples: [] },
                requiredKeys: new Set<string>(),
                patterns: [],
                errors: [],
            };
        }

        // NOTE: We only get the first compatible and hope that they are all correct
        // since there is no reason to get the bindings for all compatibles in the
        // list
        const compatible = compatibleStrings[0];
        const bindingWithPatterns = await this.get_binding_for_compatible(compatible, data);

        if (bindingWithPatterns === undefined) {
            // Treat unknown compatibles as custom nodes (no binding lookup/validation)
            return {
                binding: { required_properties: [], properties: [], examples: [] },
                requiredKeys: new Set<string>(),
                patterns: [],
                errors: [],
            };
        }

        const requiredKeys = new Set(bindingWithPatterns.parsed_binding.required_properties ?? []);

        return {
            binding: bindingWithPatterns.parsed_binding,
            requiredKeys,
            patterns: bindingWithPatterns.patterns ?? [],
            errors: bindingWithPatterns.errors ?? [],
        };
    }

    /**
     * Check if there are validation errors from the last UI validation pass.
     * This uses the error count tracked by the UI flow, avoiding re-validation.
     */
    public hasValidationErrors(): boolean {
        return this.last_validation_error_count > 0;
    }

    /**
     * Update the validation error count. Called by the UI after validation.
     */
    public setValidationErrorCount(count: number): void {
        this.last_validation_error_count = count;
    }

    /**
     * Get the current validation error count.
     */
    public getValidationErrorCount(): number {
        return this.last_validation_error_count;
    }

    /**
     * Convert a ConfigTemplatePayload returned to the webview into a plain JSON
     * structure containing only key/value pairs that mirror the DTS properties.
     */
    public configPayloadToAttachLibJson(config: ConfigTemplatePayload["config"]): Record<string, unknown> {
        const result: Record<string, unknown> = {};

        const normalizeNumericLike = (value: unknown): unknown => {
            if (typeof value === "string") {
                if (/^0x[0-9a-f]+$/i.test(value)) {
                    const parsed = Number.parseInt(value, 16);
                    return Number.isNaN(parsed) ? value : parsed;
                }
                if (/^[+-]?\d+$/.test(value)) {
                    const parsed = Number.parseInt(value, 10);
                    return Number.isNaN(parsed) ? value : parsed;
                }
                return value;
            }
            if (typeof value === "bigint") {
                // FIXME: Ajv needs a number, not a bigint, ideally
                // we change something ajv related, but this is it for now
                return Number(value);
            }
            if (Array.isArray(value)) {
                return value.map((entry) => {
                    return normalizeNumericLike(entry);
                });
            }
            return value;
        };

        const collectElements = (elements: FormElement[], target: Record<string, unknown>): void => {
            for (const element of elements) {
                switch (element.type) {
                    case "Flag": {
                        if (element.setValue !== undefined) {
                            target[element.key] = element.setValue;
                        }
                        break;
                    }
                    case "Generic": {
                        const rawValue = element.setValue;
                        if (rawValue === undefined || rawValue === null) {
                            break;
                        }
                        if (typeof rawValue === "number" && Number.isNaN(rawValue)) {
                            break;
                        }

                        target[element.key] = normalizeNumericLike(rawValue);
                        break;
                    }
                    case "FormArray": {
                        const rawValue = element.setValue;
                        if (rawValue === undefined || rawValue === null) {
                            break;
                        }
                        let normalized = normalizeNumericLike(rawValue);
                        if (Array.isArray(normalized) && Array.isArray(normalized[0])) {
                            normalized = normalized.flat();
                        }
                        if (Array.isArray(normalized) && normalized.length === 0) {
                            break;
                        }
                        target[element.key] = normalized;
                        break;
                    }
                    case "FormMatrix": {
                        const rawValue = element.setValue;
                        if (rawValue === undefined || rawValue === null) {
                            break;
                        }
                        if (!Array.isArray(rawValue)) {
                            break;
                        }
                        const rows = rawValue
                            .map((row) => Array.isArray(row) ? row : [row])
                            .map((row) => row.map((entry) => normalizeNumericLike(entry)))
                            .filter((row) => row.length > 0);
                        if (rows.length === 0) {
                            break;
                        }
                        target[element.key] = rows;
                        break;
                    }
                    case "FormObject": {
                        const nested: Record<string, unknown> = {};
                        collectElements(element.config, nested);
                        const key = element.channelName ?? element.key;
                        if (Object.keys(nested).length > 0 || element.channelName !== undefined) {
                            target[key] = nested;
                        }
                        break;
                    }
                    default: {
                        break;
                    }
                }
            }
        };

        collectElements(config.config, result);
        return result;
    }

    public isDeviceNode(node: DtsNode): boolean {
        return node.properties.some((property) => property.name === "compatible" && property.value !== undefined);
    }

    /**
     * Serialize a DTS node (and its non-device children) to the plain JSON shape
     * expected by attach-lib validation, using the current property values.
     */
    public nodeToAttachLibJson(node: DtsNode): Record<string, unknown> {
        const result: Record<string, unknown> = {};

        for (const property of node.properties) {
            if (property.name === "status") {
                continue;
            }

            if (property.value === undefined) {
                result[property.name] = true; // boolean flags are represented by presence
                continue;
            }

            result[property.name] = this.parseDtsValue(property.value);
        }

        for (const child of node.children) {
            if (this.isDeviceNode(child)) {
                continue;
            }

            const key = this.buildNodeSegment(child);
            result[key] = this.nodeToAttachLibJson(child);
        }

        return result;
    }

    public parseDtsValue(value: DtsValue): unknown {
        if (value.components.length === 1) {
            return this.parseValueComponent(value.components[0]);
        }

        return value.components.map((component) => this.parseValueComponent(component));
    }

    private parseValueComponent(component: DtsValueComponent): string | number[] | (string | bigint | undefined)[] | undefined {
        switch (component.kind) {
            case "string": {
                return component.value;
            }
            case "ref": {
                return component.ref.kind === "label" ? component.ref.name : component.ref.path;
            }
            case "bytes": {
                return component.bytes.map((byte) => byte.value);
            }
            case "array": {
                return component.elements.map((element) => this.parseArrayElement(element));
            }
            default: {
                return;
            }
        }
    }

    private parseArrayElement(element: CellArrayElement): string | bigint | undefined {
        const { item } = element;

        switch (item.kind) {
            case "number":
            case "u64": {
                return BigInt(item.value);
            }
            case "macro": {
                return item.value;
            }
            case "ref": {
                return item.ref.kind === "label" ? item.ref.name : item.ref.path;
            }
            case "expression": {
                return item.value;
            }
            default: {
                return undefined;
            }
        }
    }

    private isNodeWithinSubtree(root: DtsNode, candidate: DtsNode): boolean {
        if (root === candidate) {
            return true;
        }

        return root.children.some((child) => this.isNodeWithinSubtree(child, candidate));
    }

    private deriveCatalogDeviceGroup(bindingPath: string): string | undefined {
        const relativePath = path.relative(this.linux_bindings_folder, bindingPath);
        const normalizedPath = relativePath.startsWith("..")
            ? bindingPath
            : relativePath;

        const pathSegments = normalizedPath.split(/[/\\]/).filter(Boolean);

        // Get the group from /iio/adc/ad7124.yaml
        if (pathSegments.length >= 2) {
            const group = pathSegments.at(-2);
            if (group && group.length > 0) {
                return group;
            }
        }

        return undefined;
    }

    /**
     * Check if this is a DTSO file session
     */
    public is_dtso_session(): boolean {
        return this.is_dtso_file;
    }

    /**
     * Get the original DTSO content if available
     */
    public get_original_dtso_content(): string | undefined {
        return this.original_dtso_content;
    }

    /**
     * Get the file URI associated with this session (if any)
     */
    public get_file_uri(): vscode.Uri | undefined {
        return this.file_uri;
    }

    /**
     * Get the remembered base DTS path for DTSO sessions.
     */
    public get_base_device_tree_path(): string | undefined {
        return this.base_device_tree_path;
    }

    public set_base_device_tree_path(path: string | undefined): void {
        this.base_device_tree_path = path;
    }

    /**
     * Merge a selected DTS base file into the current DTSO overlay session.
     * The overlay content is taken from the provided dtsoOverlayText, preserving any unsaved edits.
     */
    public async merge_dtso_with_base_dts(baseDtsPath: string, dtsoOverlayText: string): Promise<void> {
        if (!this.is_dtso_file) {
            throw new Error("This command is only available for DTSO overlay sessions.");
        }

        // Save current state in case of error
        const previousDeviceTree = this.device_tree;
        const previousLabelMap = this.label_map;
        const previousBasePath = this.base_device_tree_path;
        const previousOriginalDtso = this.original_dtso_content;

        try {
            let baseContent = fs.readFileSync(baseDtsPath, { encoding: "utf8" });
            baseContent = await preprocessDtsIfNeeded(baseContent, baseDtsPath);
            const baseParse = parseDtsWithLabelMap(baseContent, false);
            const mergedDocument = mergeDtso(baseParse.document, dtsoOverlayText, true);

            this.device_tree = mergedDocument;
            this.base_device_tree_path = baseDtsPath;
            this.original_dtso_content = dtsoOverlayText;

            // Get new label map for new device tree
            const mergedLabelMap = parseDtsWithLabelMap(printDts(this.device_tree), true);
            this.label_map = mergedLabelMap.label_map;
        } catch (error) {
            // Revert to original state in case of error
            this.device_tree = previousDeviceTree;
            this.label_map = previousLabelMap;
            this.base_device_tree_path = previousBasePath;
            this.original_dtso_content = previousOriginalDtso;
            throw error;
        }
    }

    /*
     * Check if this session has a file URI and can save to disk
     */
    public has_file_uri(): boolean {
        return this.file_uri !== undefined;
    }

    /**
     * Save the current device tree to the associated file
     */
    public async save_device_tree(): Promise<void> {
        if (!this.file_uri) {
            throw new Error("No file URI associated with this session");
        }

        let device_tree_content: string = (this.is_dtso_file) ? printDtso(this.device_tree) : printDts(this.device_tree);
        await fs.promises.writeFile(this.file_uri.fsPath, device_tree_content, 'utf8');
        this.suppress_next_file_change_notification = true;
        AnalogAttachLogger.info("Saved device tree", { file: this.file_uri.fsPath, dtso: this.is_dtso_file });

        // If it's a DTSO file, update the original content
        if (this.is_dtso_file) {
            this.original_dtso_content = device_tree_content;
        }
    }

    /**
     * Whether the next document change event should be ignored for notifications
     * because it was triggered by our own save.
     */
    public consumeFileChangeNotificationSuppression(): boolean {
        if (this.suppress_next_file_change_notification) {
            this.suppress_next_file_change_notification = false;
            return true;
        }
        return false;
    }

    /**
     * Reload the in-memory model from updated DTS/DTSO text.
     * Used when the backing file changes outside the configurator UI.
     */
    public async reloadFromText(updatedContent: string): Promise<void> {
        // Remember user-added nodes by their logical path so we can restore the flag after reparse
        const userAddedPaths = this.collectUserAddedPaths(this.device_tree.root);

        const previousDeviceTree = this.device_tree;
        const previousLabelMap = this.label_map;
        const previousOriginalDtso = this.original_dtso_content;
        const previousBasePath = this.base_device_tree_path;

        AnalogAttachLogger.debug("Reloading session from disk change", { file: this.file_uri?.fsPath, dtso: this.is_dtso_file });
        try {
            if (this.is_dtso_file) {
                const reloadResult = await this.buildDtsoDocumentFromText(updatedContent);
                this.device_tree = reloadResult.document;
                this.label_map = reloadResult.labelMap;
                this.original_dtso_content = updatedContent;
                if (reloadResult.basePath !== undefined) {
                    this.base_device_tree_path = reloadResult.basePath;
                }
            } else {
                const parseResult = parseDtsWithLabelMap(updatedContent, false);
                this.device_tree = parseResult.document;
                this.label_map = parseResult.label_map;
            }

            // Reapply created_by_user flags based on saved paths
            this.restoreUserAddedFlags(this.device_tree.root, userAddedPaths);
            AnalogAttachLogger.info("Reloaded session from disk", { file: this.file_uri?.fsPath });
        } catch (error) {
            // Restore previous state on failure so the session remains usable.
            this.device_tree = previousDeviceTree;
            this.label_map = previousLabelMap;
            this.original_dtso_content = previousOriginalDtso;
            this.base_device_tree_path = previousBasePath;
            AnalogAttachLogger.error("Failed to reload session from disk", { file: this.file_uri?.fsPath, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    // FIXME: HACK: when refreshing (e.g. after an external change) we should
    // preserve the flags and stuff. This does not happen now because the lib
    // re assigns UUIDs. Re assigning the same UUIDs is another option, but it
    // can create issues and it seems more hackish than this. This should also
    // be fixed once the metadata system is in place (fingers crossed).
    /** Collect logical paths for nodes marked created_by_user */
    private collectUserAddedPaths(root: DtsNode): Set<string> {
        const paths = new Set<string>();

        const visit = (node: DtsNode, path: string[]) => {
            const segment = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
            const nextPath = [...path, segment];

            if (node.created_by_user === true) {
                paths.add(`/${nextPath.join("/")}`);
            }

            for (const child of node.children) {
                visit(child, nextPath);
            }
        };

        visit(root, []);
        return paths;
    }

    /** Restore created_by_user flags on nodes whose paths match the saved set */
    private restoreUserAddedFlags(root: DtsNode, userAddedPaths: Set<string>): void {
        const visit = (node: DtsNode, path: string[]) => {
            const segment = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
            const nextPath = [...path, segment];
            const fullPath = `/${nextPath.join("/")}`;

            if (userAddedPaths.has(fullPath)) {
                node.created_by_user = true;
                node.modified_by_user = true;
            }

            for (const child of node.children) {
                visit(child, nextPath);
            }
        };

        visit(root, []);
    }

    private async buildDtsoDocumentFromText(updatedContent: string): Promise<{ document: DtsDocument; labelMap: Map<string, string>; basePath?: string }> {
        let dtsoDocument: ReturnType<typeof parseDtso>;
        try {
            dtsoDocument = parseDtso(updatedContent);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse DTSO content: ${message}`);
        }

        if (this.base_device_tree_path) {
            try {
                let baseContent = await fs.promises.readFile(this.base_device_tree_path, { encoding: "utf8" });
                baseContent = await preprocessDtsIfNeeded(baseContent, this.base_device_tree_path);
                const baseParse = parseDtsWithLabelMap(baseContent, false);
                const mergedDocument = mergeDtso(baseParse.document, updatedContent, true);
                const labelMapResult = parseDtsWithLabelMap(printDts(mergedDocument), true);
                return { document: mergedDocument, labelMap: labelMapResult.label_map, basePath: this.base_device_tree_path };
            } catch (error) {
                console.warn(`Failed to reload base device tree from ${this.base_device_tree_path}:`, error);
                vscode.window.showWarningMessage(`Failed to reload base device tree from ${this.base_device_tree_path}. Overlay will be shown without it.`);
                this.base_device_tree_path = undefined;
            }
        }

        if (dtsoDocument.unresolved_overlays && dtsoDocument.unresolved_overlays.length > 0) {
            const emptyDts = String.raw`/dts-v1/;
/ {};`;
            const emptyParse = parseDtsWithLabelMap(emptyDts, true);
            const mergedDocument = mergeDtso(emptyParse.document, updatedContent, true);
            const mergedLabelMap = parseDtsWithLabelMap(printDts(mergedDocument), true);
            return { document: mergedDocument, labelMap: mergedLabelMap.label_map };
        }

        markNodesModified(dtsoDocument.root);
        const parseResult = parseDtsWithLabelMap(printDts(dtsoDocument), true);
        return { document: dtsoDocument, labelMap: parseResult.label_map };
    }

    /**
     * Merge a DTSO overlay into the current device tree
     * @param dtsoText The DTSO overlay text to merge
     * @param markAsModified If true, mark all nodes/properties from the overlay with modifiedByUser flag
     */
    public merge_dtso_overlay(dtsoText: string, markAsModified: boolean = true): void {
        const previousDeviceTree = this.device_tree;
        const previousLabelMap = this.label_map;

        try {
            const mergedDocument = mergeDtso(this.device_tree, dtsoText, markAsModified);
            this.device_tree = mergedDocument;

            // Rebuild the label map after merging
            const parseResult = parseDtsWithLabelMap(printDts(this.device_tree), true);
            this.label_map = parseResult.label_map;
        } catch (error) {
            this.device_tree = previousDeviceTree;
            this.label_map = previousLabelMap;
            const message = error instanceof Error ? error.message : String(error);
            AnalogAttachLogger.error("Failed to merge DTSO overlay", { error: message });
            vscode.window.showErrorMessage(`Failed to merge overlay: ${message}`);
        }
    }


    /**
     * Extract compatible strings from a DTS node.
     * The compatible property can be a single string or an array of strings.
     * @throws if the compatible property is missing/empty/invalid
     */
    private getCompatibleStringsFromNode(node: DtsNode): string[] {
        const compatibleProperty = node.properties.find((property: DtsProperty) => property.name === "compatible");

        if (compatibleProperty === undefined) {
            throw new Error(`Did not find a compatible property in the device ${node.name}`);
        }

        if (compatibleProperty.value === undefined) {
            throw new Error(`The compatible property does not have a value for ${node.name}`);
        }

        if (compatibleProperty.value.components.length === 0) {
            AnalogAttachLogger.warn("Node has no compatible property");
            AnalogAttachLogger.warn("Node being edited:", node.name);
            AnalogAttachLogger.warn("Node properties:", node.properties.map(p => p.name));
            throw new Error(`The compatible property is empty for the ${node.name} device`);
        }

        const values: string[] = [];

        for (const component of compatibleProperty.value.components) {
            if (component.kind === "string") {
                values.push(component.value);
            }
            if (component.kind === "array") {
                for (const element of component.elements) {
                    // compatible would only have expressions probably
                    if (element.item.kind === "expression") {
                        values.push(element.item.value);
                    }
                }
            }
        }

        if (values.length === 0) {
            throw new Error(`Cannot extract values from compatible, unsupported types for ${node.name}`);
        }

        AnalogAttachLogger.info("Compatible strings found:", values);
        return values;
    }

    public async get_binding(binding_path: string, data: string): Promise<{
        parsed_binding: ParsedBinding,
        patterns: string[],
        errors: BindingErrors[]
    } | undefined> {

        let attach = Attach.new();

        const parsed_binding_and_pattern = await attach.parse_binding(binding_path, this.linux_path, this.dt_schema_path);

        if (!parsed_binding_and_pattern) {
            vscode.window.showErrorMessage("Failed to parse binding!");
            return;
        }

        const normalizedData = data.trim() === "" ? "{}" : data;
        const updated_binding = attach.update_binding_by_changes(normalizedData);

        if (updated_binding === undefined) {
            vscode.window.showErrorMessage("Failed to update parsed binding!");
            return;
        }

        const parsedBinding = updated_binding.binding;
        if (parsed_binding_and_pattern.parsed_binding.pattern_properties) {
            parsedBinding.pattern_properties = parsed_binding_and_pattern.parsed_binding.pattern_properties;
        }
        parsed_binding_and_pattern.parsed_binding = parsedBinding;

        return {
            ...parsed_binding_and_pattern,
            errors: updated_binding.errors
        };
    }

    public async upload_to_device(device_name: string): Promise<{ status: "ERROR"; msg: string; } | { status: "OK"; } | undefined> {
        const compile_dts_command = vscode.workspace.getConfiguration('analog-attach').get<string>('compileDtsFileCommand');

        if (!compile_dts_command) {
            vscode.window.showErrorMessage(`Compile dts file command not set!`);
            return;
        }

        const sshpass_config = vscode.workspace.getConfiguration('analog-attach').get<string>('sshpassConfig');

        if (!sshpass_config) {
            vscode.window.showErrorMessage(`Sshpass config not set!`);
            return;
        }

        const ssh_config = vscode.workspace.getConfiguration('analog-attach').get<string>('sshConfig');

        if (!ssh_config) {
            vscode.window.showErrorMessage(`Ssh config not set!`);
            return;
        }

        const write_dtb_to_overlays = vscode.workspace.getConfiguration('analog-attach').get<string>('writeDtbToOverlays');

        if (!write_dtb_to_overlays) {
            vscode.window.showErrorMessage(`Write Dtb to overlays command not set!`);
            return;
        }

        const device_tree = printDts(this.device_tree);

        const composed_command = `echo '${device_tree}' | ${compile_dts_command} | ${sshpass_config} ${ssh_config}`
            .replace("{command}", write_dtb_to_overlays)
            .replace("{dtb_name}", `${device_name}.dtb`);

        console.log(`Running ${composed_command}`);

        const { stdout, stderr } = await exec(composed_command);

        if (stderr === "") {
            console.log(`stdout: ${stdout}`);

            return { status: "OK" };
        } else {
            return { status: "ERROR", msg: stderr };
        }

    }

    public async reboot_device(): Promise<{ status: "ERROR"; msg: string; } | { status: "OK"; } | undefined> {
        const sshpass_config = vscode.workspace.getConfiguration('analog-attach').get<string>('sshpassConfig');

        if (!sshpass_config) {
            vscode.window.showErrorMessage(`Sshpass config not set!`);
            return;
        }

        const ssh_config = vscode.workspace.getConfiguration('analog-attach').get<string>('sshConfig');

        if (!ssh_config) {
            vscode.window.showErrorMessage(`Ssh config not set!`);
            return;
        }

        const reboot_device_command = vscode.workspace.getConfiguration('analog-attach').get<string>('rebootDevice');

        if (!reboot_device_command) {
            vscode.window.showErrorMessage(`Compile on Device Command not set!`);
            return;
        }

        const composed_command = `${sshpass_config} ${ssh_config}`.replace("{command}", reboot_device_command);

        console.log(`Running ${composed_command}`);

        const { stdout, stderr } = await exec(composed_command);

        if (stderr !== "" && (!stderr.includes("Connection") && !stderr.includes("closed."))) {
            return { status: "ERROR", msg: stderr };
        } else {
            console.log(`stdout: ${stdout}`);
            return { status: "OK" };
        }

    }

    /**
     * Depth-first search for the UUID, can be optimized later by keeping a lazy map
     * of the UUID -> DtsNode if it will be necessary
     * @param root The search root
     * @param uuid The UUID for the node
     * @returns The found node or undefined in case it does not exist
     */
    public find_node_by_uuid(uuid: UUID): DtsNode | undefined {
        const visit = (uuid: UUID, root: DtsNode): DtsNode | undefined => {
            if (root._uuid === uuid) {
                return root;
            }

            for (const child of root.children) {
                const hit = visit(uuid, child);
                if (hit) {
                    return hit;
                }
            }

            return undefined;
        };

        return visit(uuid, this.device_tree.root);
    }

    public find_parent_node_by_uuid(child_uuid: UUID): DtsNode | undefined {
        const visit = (child_uuid: UUID, root: DtsNode): DtsNode | undefined => {
            for (const child of root.children) {
                if (child._uuid === child_uuid) {
                    return root;
                }

                const hit = visit(child_uuid, child);
                if (hit) {
                    return hit;
                }
            }

            return undefined;
        };

        return visit(child_uuid, this.device_tree.root);
    }

    /**
     * This function should not be used and should eventually be obsolete, this is just to
     * help in the transition from path to UUID
     * @param path 
     * @returns 
     */
    public path_to_uuid(path: string): UUID | undefined {
        const segments = path === "/" ? [] : path.replace(/^\/+/, "").split("/").filter(Boolean);

        let node = this.device_tree.root;
        if (segments.length === 0) {
            return node._uuid;
        }

        for (const segment of segments) {
            if (!node) {
                return undefined;
            }

            const child = node.children.find((c) => {
                const seg = c.unit_addr ? `${c.name}@${c.unit_addr}` : c.name;
                return seg === segment;
            });

            if (!child) {
                return undefined;
            }

            node = child;
        }

        return node ? node._uuid : undefined;
    }
}
