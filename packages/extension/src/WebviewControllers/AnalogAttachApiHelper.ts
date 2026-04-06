import {
    type FormElement,
    type GenericFormElement,
    type FormObjectElement,
    type MatrixValidation,
    type EnumValueType,
    type ConfigTemplatePayload,
    type ParentNode,
    type DeviceUID,
    ArrayMixedTypeValidation,
} from "extension-protocol";
import {
    Attach,
    expand_regex,
    type BindingErrors,
    type DtsNode,
    type DtsProperty,
    type DtsValueComponent,
    type ParsedBinding,
    type CellArrayElement,
    query_devicetree,
    insert_known_structures,
    cell_extract_first_value,
} from "attach-lib";
import {
    dtsValueComponent,
    dtsCellElement,
    dtsCellArray,
    dtsProperty,
    dtsFlagProperty,
    dtsString,
    dtsStatusProperty,
    dtsRefElement as dtsReferenceElement,
    dtsNode,
} from "./DtsAstBuilders";
import { AttachSession } from "../AttachSession/AttachSession";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { bigIntReplacer } from "../utilities";
import { DeviceState } from "./DeviceState";

export class ConfigValidationError extends Error {
    public readonly config: ConfigTemplatePayload;

    public constructor(message: string, config: ConfigTemplatePayload) {
        super(message);
        this.name = "ConfigValidationError";
        this.config = config;
    }
}

/**
 * Shared Analog Attach API helper used by both webview controllers.
 * Contains the logic for building device tree/configuration payloads and
 * mutating the AttachSession in response to API commands.
 */
export class AnalogAttachApiHelper {
    public constructor(private readonly attachSession: AttachSession) { }

    /**
     * Prefill the reg element's setValue from unit_addr when reg has no value.
     * This centralizes the logic for prefilling reg from the node's unit address.
     */
    private prefillRegFromUnitAddr(elements: FormElement[], unitAddr: string | undefined): void {
        if (unitAddr === undefined) {
            return;
        }

        const regElement = elements.find((element) => element.key === "reg");
        if (regElement === undefined || regElement.type === "FormObject" || regElement.setValue !== undefined) {
            return;
        }

        const parsed = unitAddr.startsWith("0x")
            ? Number.parseInt(unitAddr, 16)
            : Number.parseInt(unitAddr, 10);

        if (Number.isNaN(parsed)) {
            return;
        }

        if (regElement.type === "FormMatrix") {
            regElement.setValue = [[parsed]];
        } else if (regElement.type === "FormArray") {
            regElement.setValue = [parsed];
        } else {
            regElement.setValue = parsed;
        }
    }

    /**
     * Sync the unit_addr field from the reg property value.
     * This ensures the unit address stays in sync when reg is modified.
     */
    private syncUnitAddrFromReg(node: DtsNode): void {
        if (!node.modified_by_user) {
            return;
        }

        const reg = node.properties.find((p) => p.name === "reg");
        if (!reg?.value) {
            return;
        }

        const regValue = cell_extract_first_value(reg);
        if (typeof regValue === "bigint") {
            node.unit_addr = regValue.toString();
        }
    }

    public getCatalogDevices() {
        return this.attachSession.get_catalog_devices();
    }

    public setNodeActive(uuid: DeviceUID, active: boolean): boolean {
        // Parse the UID to get the node path
        const node = this.attachSession.find_node_by_uuid(uuid);
        if (node === undefined) {
            throw new Error(`Invalid UID: ${uuid}`);
        }

        // Set the active status using the existing setNodeActive method
        this.setNodeActiveInternal(node, active);

        return active;
    }

    public buildDeviceTreeFormElement(): FormObjectElement {
        const deviceTree = this.attachSession.get_device_tree();
        return this.convertDtsNodeToFormElement(deviceTree.root);
    }

    /**
     * Build the device configuration payload.
     * Uses DeviceState as the single source of truth for all device properties,
     * channels, and touched subnodes.
     *
     * @param deviceUID The device UUID
     * @returns ConfigTemplatePayload for the frontend
     */
    public async buildDeviceConfiguration(
        deviceUID: DeviceUID,
    ): Promise<ConfigTemplatePayload> {
        const node = this.attachSession.find_node_by_uuid(deviceUID);
        if (node === undefined) {
            throw new Error(`Cannot find node with UUID: ${deviceUID}`);
        }

        const parentNode = this.attachSession.find_parent_node_by_uuid(deviceUID);
        if (parentNode === undefined) {
            throw new Error(`Cannot find parent node from node with UUID: ${deviceUID}`);
        }

        // Get or create DeviceState - single source of truth
        // This internally resolves and enriches the binding
        const deviceState = await this.attachSession.getOrCreateDeviceState(deviceUID);

        // All elements come from DeviceState (properties, touched subnodes, channels)
        const allElements = deviceState.toFormElements(this.attachSession);

        // Prefill reg from unit_addr for device-level elements
        this.prefillRegFromUnitAddr(allElements, node.unit_addr);

        // Prefill reg from unit_addr for channel elements
        for (const element of allElements) {
            if (element.type === "FormObject" && element.channelName) {
                const atIndex = element.channelName.lastIndexOf("@");
                if (atIndex !== -1) {
                    const unitAddr = element.channelName.slice(atIndex + 1);
                    this.prefillRegFromUnitAddr(element.config, unitAddr);
                }
            }
        }

        const channelRegexes = deviceState.channelRegexStrings ?? [];
        const generatedChannelRegexEntries = this.generateChannelRegexEntries(channelRegexes);

        const payload: ConfigTemplatePayload = {
            config: {
                type: "DeviceConfigurationFormObject",
                alias: deviceState.alias,
                active: deviceState.active,
                maxChannels: deviceState.channels.size > 0 ? deviceState.channels.size : undefined,
                config: allElements,
                parentNode: {
                    uuid: deviceState.parentUUID,
                    name: deviceState.parentName,
                },
                channelRegexes: channelRegexes.length > 0 ? channelRegexes : undefined,
                generatedChannelRegexEntries: generatedChannelRegexEntries,
            },
        };

        // Single validation pass using DeviceState
        const errors = deviceState.validate();
        if (errors.length > 0) {
            this.applyValidationErrors(payload, errors);
        }

        return payload;
    }

    public async applyConfigurationUpdates(
        deviceUID: DeviceUID,
        config: ConfigTemplatePayload["config"],
        parentNode: ParentNode
    ): Promise<{ deviceUID: DeviceUID; validationErrors: BindingErrors[] }> {
        const restorePoint = this.attachSession.create_restore_point();

        try {
            const verification = await this.validateConfigurationWithAttachLib(deviceUID, config, parentNode);

            let node = this.attachSession.move_device_node(deviceUID, parentNode.uuid);

            if (config.alias !== undefined && config.alias !== node.labels.at(0)) {
                this.setNodeAlias(node, config.alias);
                // Invalidate all device states since alias changes affect phandle enums
                this.attachSession.invalidateAllDeviceStates();
            }

            if (config.active !== undefined) {
                this.setNodeActiveInternal(node, config.active);
            }

            if (verification.channelElements.length > 0) {
                this.applyChannelConfigurations(node, verification.channelElements);
            }

            // Remove channels that are not present in the payload
            if (verification.hasChannelPatterns) {
                this.removeChannelsIfMissing(node, verification.channelElements, verification.compiledChannelRegexes);
            }

            if (verification.deviceElements.length > 0) {
                this.applyFormElementsToNode(node, verification.deviceElements);
                this.pruneMissingDeviceProperties(node, verification.deviceElements);
            }

            // Invalidate the DeviceState cache since the node has been modified
            // This ensures the next getOrCreateDeviceState call rebuilds from fresh node data
            this.attachSession.invalidateDeviceState(node._uuid);

            // Update DeviceState cache for custom property tracking
            await this.updateDeviceStateCache(node._uuid, verification.deviceElements);

            // Sync unit_addr from reg property for device and channels
            this.syncUnitAddrFromReg(node);
            for (const channel of node.children) {
                this.syncUnitAddrFromReg(channel);
            }

            return {
                deviceUID: node._uuid,
                validationErrors: verification.validationErrors
            };
        } catch (error) {
            this.attachSession.restore_from_restore_point(restorePoint);
            throw error;
        }
    }

    /**
     * Update DeviceState cache with custom property metadata from form elements.
     * This preserves custom property types (custom, custom-flag, custom-number, custom-phandle)
     * across save/load cycles.
     *
     * Note: We only update an existing cached DeviceState. If no cached state exists,
     * we skip caching - the next getOrCreateDeviceState call will create a fresh one
     * from the DTS node which already has the custom property info via modified_by_user.
     */
    private async updateDeviceStateCache(
        deviceUID: DeviceUID,
        deviceElements: FormElement[]
    ): Promise<void> {
        const deviceState = await this.attachSession.getOrCreateDeviceState(deviceUID);

        // Update custom property metadata
        for (const element of deviceElements) {
            if (element.type === "FormObject") {
                continue;
            }

            if (element.type === "Generic") {
                const inputType = (element as GenericFormElement).inputType;
                if (inputType?.startsWith("custom")) {
                    const existing = deviceState.properties.get(element.key);
                    const customType = this.inputTypeToCustomType(inputType);
                    if (existing) {
                        existing.isCustom = true;
                        existing.customType = customType;
                        existing.value = element.setValue;
                    } else {
                        deviceState.properties.set(element.key, {
                            key: element.key,
                            value: element.setValue,
                            isCustom: true,
                            customType,
                        });
                    }
                }
            }
        }

        // Remove custom properties that are no longer in the elements
        const elementKeys = new Set(deviceElements.map(element => element.key));
        for (const [key, propertyState] of deviceState.properties) {
            if (!elementKeys.has(key) && propertyState.isCustom) {
                deviceState.properties.delete(key);
            }
        }
    }

    /**
     * Convert inputType to CustomPropertyType.
     */
    private inputTypeToCustomType(inputType: string): "text" | "flag" | "number" | "phandle" {
        switch (inputType) {
            case "custom-flag": {
                return "flag";
            }
            case "custom-number": {
                return "number";
            }
            case "custom-phandle": {
                return "phandle";
            }
            default: {
                return "text";
            }
        }
    }

    /**
     * Validate configuration using the correct flow:
     * 1. Parse binding (no validation)
     * 2. Enrich binding with devicetree queries
     * 3. Validate with properly shaped data from form elements
     *
     * Form data from the webview is already shaped correctly (FormMatrix → [[value]],
     * FormArray → [value]) because the form elements know their types.
     */
    private async validateConfigurationWithAttachLib(
        deviceUID: DeviceUID,
        config: ConfigTemplatePayload["config"],
        parentNode: ParentNode
    ): Promise<{
        compiledChannelRegexes: RegExp[];
        channelElements: FormObjectElement[];
        deviceElements: FormElement[];
        hasChannelPatterns: boolean;
        validationErrors: BindingErrors[];
    }> {
        try {
            // Strip any error annotations echoed back from the webview so we start clean
            this.stripErrorsFromConfig(config);

            if (!parentNode || !parentNode.uuid) {
                throw new Error("Parent node is required for configuration updates");
            }

            this.attachSession.preflight_move_device_node(deviceUID, parentNode.uuid);

            const node = this.attachSession.find_node_by_uuid(deviceUID);
            if (node === undefined) {
                throw new Error(`Cannot find node with UUID: ${deviceUID}`);
            }

            // Form data is already shaped correctly from webview FormElements
            const data = this.attachSession.configPayloadToAttachLibJson(config);
            const serializedData = JSON.stringify(data, bigIntReplacer);

            // Step 1: Parse binding (no validation yet)
            const candidateCompatible = this.extractCompatibleValue(config.config);
            let binding: ParsedBinding = { required_properties: [], properties: [], examples: [] };
            let patterns: string[] = [];
            let attach: Attach | undefined;

            if (candidateCompatible) {
                AnalogAttachLogger.debug("Resolving binding for compatible", { compatible: candidateCompatible });
                const parseResult = await this.attachSession.get_binding_for_compatible_parse_only(candidateCompatible);

                if (parseResult) {
                    binding = parseResult.parsed_binding;
                    patterns = parseResult.patterns ?? [];
                    attach = parseResult.attach;
                    AnalogAttachLogger.debug("Resolved binding for compatible", { compatible: candidateCompatible, patterns: patterns.length });
                } else {
                    AnalogAttachLogger.warn("Unknown compatible string, treating as custom node", { compatible: candidateCompatible });
                }
            }

            const device_tree = this.attachSession.get_device_tree();

            // Step 2: Enrich binding with devicetree queries
            binding.properties = query_devicetree(
                device_tree,
                binding.properties,
                serializedData,
                parentNode.name
            );
            binding.properties = insert_known_structures(binding.properties);

            if (binding.pattern_properties !== undefined) {
                for (const pattern of binding.pattern_properties) {
                    pattern.properties = query_devicetree(device_tree, pattern.properties, serializedData, parentNode.name);
                    pattern.properties = insert_known_structures(pattern.properties);
                }
            }

            // Step 3: Validate with the enriched binding
            // We only take errors from validation - keep the enriched binding
            let validationErrors: BindingErrors[] = [];
            if (attach) {
                const normalizedData = serializedData.trim() === "" ? "{}" : serializedData;
                const updateResult = attach.update_binding_by_changes(normalizedData);
                if (updateResult) {
                    validationErrors = updateResult.errors;
                }
            }

            if (config.alias !== undefined) {
                this.setNodeAlias(node, config.alias);
            }

            const compiledChannelRegexes = this.compileChannelRegexes(patterns);
            const hasChannelPatterns = compiledChannelRegexes.length > 0;

            const configFormList = config.config;
            const channelElements = configFormList.filter((element): element is FormObjectElement => {
                if (element.type !== "FormObject") {
                    return false;
                }

                const channelSegment = element.channelName ?? element.key;

                if (!hasChannelPatterns) {
                    // Fallback: honor explicit channelName when no patterns are provided
                    return element.channelName !== undefined;
                }

                return this.matchesAnyChannelPattern(channelSegment, compiledChannelRegexes);
            });

            const deviceElements = configFormList.filter((element) => {
                if (element.type !== "FormObject") {
                    return true;
                }

                if (channelElements.includes(element)) {
                    return false;
                }

                if (!hasChannelPatterns) {
                    return element.channelName === undefined;
                }

                if (element.channelName !== undefined) {
                    return false;
                }

                return !this.matchesAnyChannelPattern(element.key, compiledChannelRegexes);
            });

            // Filter and count errors, then update session for compile-time warning
            const filteredErrors = this.suppressUnsupportedErrors(validationErrors);
            this.attachSession.setValidationErrorCount(filteredErrors.length);

            return {
                compiledChannelRegexes,
                channelElements,
                deviceElements,
                hasChannelPatterns,
                validationErrors: filteredErrors,
            };
        } catch (error) {
            AnalogAttachLogger.error("[error] validateConfigurationWithAttachLib failed", error);
            const errorPayload: ConfigTemplatePayload = { config: structuredClone(config) };
            errorPayload.config.genericErrors = [{
                code: "generic",
                message: "Validation failed",
                details: error instanceof Error ? error.message : String(error),
            }];
            throw new ConfigValidationError("Validation failed", errorPayload);
        }
    }

    private extractCompatibleValue(elements: FormElement[]): string | undefined {
        for (const element of elements) {
            if (element.type === "FormObject") {
                // Skip channel objects; compatible is only meaningful at the device level
                continue;
            }

            if (element.key !== "compatible") {
                continue;
            }

            if (element.type === "Generic") {
                const value = element.setValue;
                if (typeof value === "string") {
                    return value;
                }
                if (Array.isArray(value)) {
                    const first = value.find((item) => typeof item === "string") as string | undefined;
                    if (first) {
                        return first;
                    }
                }
            }

            if (element.type === "FormArray") {
                const value = element.setValue;
                if (Array.isArray(value)) {
                    const first = value.find((item) => typeof item === "string") as string | undefined;
                    if (first) {
                        return first;
                    }
                }
            }
        }

        return undefined;
    }

    private generateChannelRegexEntries(channelRegexes: string[]): string[] | undefined {
        const entries: string[] = [];
        for (const pattern of channelRegexes) {
            try {
                const expanded = expand_regex(new RegExp(pattern));
                entries.push(...expanded);
            } catch {
                // Ignore patterns we cannot expand automatically
            }
        }

        if (entries.length === 0) {
            return undefined;
        }

        return [...new Set(entries)];
    }

    /**
     * Remove error annotations and genericErrors from a config payload (in-place).
     * The webview can echo previous errors back; we must start each validation clean.
     */
    public stripErrorsFromConfig(config: ConfigTemplatePayload["config"]): void {
        config.genericErrors = undefined;

        const walk = (elements: FormElement[]): void => {
            for (const element of elements) {
                element.error = undefined;
                if (element.type === "FormObject") {
                    walk(element.config);
                }
            }
        };

        walk(config.config);
    }

    private compileChannelRegexes(patterns: string[]): RegExp[] {
        const regexes: RegExp[] = [];

        for (const pattern of patterns) {
            try {
                regexes.push(new RegExp(pattern));
            } catch {
                // ignore invalid regex
            }
        }

        return regexes;
    }

    private matchesAnyChannelPattern(name: string, regexes: RegExp[]): boolean {
        if (regexes.length === 0) {
            return false;
        }

        return regexes.some((regex) => regex.test(name));
    }

    private propertyToFormElement(property: DtsProperty, required: boolean): FormElement | undefined {
        if (property.value === undefined) {
            return {
                type: "Flag",
                key: property.name,
                required,
                defaultValue: false,
            };
        }

        const parsedValue = this.attachSession.parseDtsValue(property.value);

        // Check if this is a single-element numeric array from a user-modified property
        // These should be treated as custom-number, not FormArray
        const isSingleNumber = Array.isArray(parsedValue) &&
            parsedValue.length === 1 &&
            (typeof parsedValue[0] === "number" || typeof parsedValue[0] === "bigint");

        if (isSingleNumber && property.modified_by_user === true) {
            return {
                type: "Generic",
                key: property.name,
                inputType: "custom-number",
                required,
                setValue: Number(parsedValue[0]),
            };
        }

        if (Array.isArray(parsedValue)) {
            return {
                type: "FormArray",
                key: property.name,
                required,
                setValue: parsedValue,
                defaultValue: [],
            };
        }

        // Only treat user-modified properties as custom so the FE preserves custom renderers
        const getCustomInputType = (): "custom-flag" | "custom-number" | "custom-phandle" | "custom" => {
            if (typeof parsedValue === "boolean") {
                return "custom-flag";
            }
            if (typeof parsedValue === "number" || typeof parsedValue === "bigint") {
                return "custom-number";
            }
            if (typeof parsedValue === "string" && parsedValue.startsWith("&")) {
                return "custom-phandle";
            }
            return "custom";
        };
        const inputType = property.modified_by_user === true ? getCustomInputType() : "text";

        return {
            type: "Generic",
            key: property.name,
            inputType,
            required,
            setValue: parsedValue,
        };
    }

    private applyChannelConfigurations(
        deviceNode: DtsNode,
        channelElements: FormObjectElement[],
    ): void {
        for (const element of channelElements) {
            const channelSegment = element.channelName ?? element.key;
            if (!channelSegment) {
                continue;
            }

            let channelNode = this.findChildNode(deviceNode, channelSegment);

            if (!channelNode) {
                channelNode = this.createChannelNode(channelSegment);
                deviceNode.children.push(channelNode);
                deviceNode.modified_by_user = true;
            }

            if (element.alias !== undefined) {
                this.setNodeAlias(channelNode, element.alias);
            }

            if (Array.isArray(element.config)) {
                this.applyFormElementsToNode(channelNode, element.config);
            }
        }
    }

    private createChannelNode(segment: string): DtsNode {
        const [name, unitAddr] = segment.split("@", 2);
        const properties: DtsProperty[] = [];

        // Also add the reg property in case we have a unitAddr
        if (unitAddr !== undefined) {
            const parsed = unitAddr.startsWith("0x") ? Number.parseInt(unitAddr, 16) : Number.parseInt(unitAddr, 10);

            if (!Number.isNaN(parsed)) {
                const component = dtsValueComponent([parsed]);
                if (component) {
                    properties.push(dtsProperty("reg", component));
                } else {
                    AnalogAttachLogger.warn("Cannot create reg property based on unit_addr for", segment);
                }
            }
        }

        return dtsNode({
            name,
            unitAddr,
            properties,
        });
    }

    private hasAnySetSubChildren(element: FormObjectElement): boolean {
        for (const child of element.config) {
            if (child.type === "FormObject") {
                const hit = this.hasAnySetSubChildren(child);
                if (hit) {
                    return true;
                }
            } else {
                if (child.setValue !== undefined) {
                    return true;
                }
            }
        }

        return false;
    }

    private applyFormElementsToNode(node: DtsNode, elements: FormElement[]): void {
        for (const element of elements) {
            switch (element.type) {
                case "FormObject": {
                    if (element.channelName !== undefined) {
                        break;
                    }

                    let child = this.findChildNode(node, element.key);
                    if (this.hasAnySetSubChildren(element)) {
                        // Create the child if it doesn't exist
                        if (child === undefined) {
                            const [name, unitAddr] = element.key.split("@", 2);
                            child = dtsNode({ name, unitAddr });
                            node.children.push(child);
                            node.modified_by_user = true;
                        }

                        this.applyFormElementsToNode(child, element.config);
                    } else if (child !== undefined) {
                        // Typescript narrowing was complaining..
                        const existingChild = child;
                        const nodeIndex = node.children.findIndex(item => item._uuid === existingChild._uuid);
                        if (nodeIndex !== -1) {
                            node.children.splice(nodeIndex, 1);
                            node.modified_by_user = true;
                        }
                    }

                    break;
                }
                default: {
                    this.applySingleFormElement(node, element);
                    break;
                }
            }
        }
    }

    /**
     * Remove device-level properties that are not present in the current payload.
     * This helps keep renamed custom properties from leaving stale entries behind.
     * // FIXME: This should be removed, helps the custom properties problem, see
     * // another fixme above that explains it
     */
    private pruneMissingDeviceProperties(node: DtsNode, elements: FormElement[]): void {
        const allowedKeys = new Set<string>();

        const collectKeys = (list: FormElement[]): void => {
            for (const element of list) {
                if (element.type === "FormObject") {
                    // device-level call only expects non-channel objects here, but recurse just in case
                    collectKeys(element.config);
                } else {
                    allowedKeys.add(element.key);
                }
            }
        };

        collectKeys(elements);

        node.properties = node.properties.filter((property) => {
            if (property.name === "status") {
                return true;
            }
            return allowedKeys.has(property.name);
        });
    }

    private applySingleFormElement(node: DtsNode, element: FormElement): void {
        if (element.key === "alias" && element.type === "Generic") {
            const alias = element.setValue as string | undefined;
            this.setNodeAlias(node, alias ?? "");
            return;
        }

        switch (element.type) {
            case "Flag": {
                const normalized = element.setValue === false ? undefined : element.setValue;
                if (normalized === undefined) {
                    this.removeProperty(node, element.key);
                } else if (normalized === true) { // just to be explicit
                    this.upsertProperty(node, element.key);
                } else {
                    AnalogAttachLogger.warn(`Unexpected flag value for ${element.key}, skipping apply`, { normalized });
                }
                break;
            }
            case "Generic": {
                const genericElement = element as GenericFormElement;

                // Treat boolean/blank generics as custom flags (presence = true)
                if (genericElement.inputType === "custom-flag" || genericElement.setValue === undefined) {
                    if (genericElement.setValue === false || genericElement.setValue === undefined) {
                        this.removeProperty(node, genericElement.key);
                    } else {
                        this.upsertProperty(node, genericElement.key);
                    }
                    break;
                }

                // Only write to device tree if user explicitly set a value
                if (genericElement.setValue === undefined) {
                    this.removeProperty(node, genericElement.key);
                    break;
                }

                // Handle custom-phandle: write as <&label> (array containing ref)
                if (genericElement.inputType === "custom-phandle") {
                    const phandleValue = String(genericElement.setValue);
                    const arrayComponent = dtsCellArray([dtsReferenceElement(phandleValue)]);
                    this.upsertProperty(node, genericElement.key, arrayComponent);
                    break;
                }

                const component = this.buildValueComponent(genericElement.setValue);
                if (component) {
                    this.upsertProperty(node, genericElement.key, component);
                } else {
                    this.removeProperty(node, genericElement.key);
                }
                break;
            }
            case "FormArray": {
                // Only write to device tree if user explicitly set a value
                if (element.setValue === undefined) {
                    this.removeProperty(node, element.key);
                    break;
                }
                if (!Array.isArray(element.setValue)) {
                    this.removeProperty(node, element.key);
                    break;
                }
                const shouldFlatten = element.setValue.every(
                    (entry) => typeof entry === "string" || Array.isArray(entry)
                );
                const normalizedValues = shouldFlatten && element.setValue.some((element) => Array.isArray(element))
                    ? element.setValue.flatMap((entry) => Array.isArray(entry) ? entry : [entry])
                    : element.setValue;
                const allStrings = normalizedValues.every((entry) => typeof entry === "string");
                const components: DtsValueComponent[] = [];
                const validationType = element.validationType;

                if (validationType?.type === "ArrayMixedTypeValidation") {
                    // Check if all prefixItems are StringList with string enumType - these should be printed as quoted strings
                    const allStringLists = validationType.prefixItems.every(
                        (item) => item.type === "StringList" && item.enumType === "string"
                    );
                    const stringValues = normalizedValues as string[];
                    const allNonNumericStrings = allStrings && !stringValues.every((s) => this.isNumericLike(s));

                    if (allStringLists && allNonNumericStrings) {
                        // Create string components for proper "value1", "value2" output
                        for (const entry of stringValues) {
                            components.push(dtsString(entry));
                        }
                    } else {
                        const component = this.buildArrayComponent(normalizedValues, { prefixItems: validationType.prefixItems });
                        if (component) {
                            components.push(component);
                        }
                    }
                } else if (validationType?.type === "ArrayHyperlinkValidation") {
                    // Phandle arrays - values are labels that need to be converted to references
                    const component = this.buildArrayComponent(normalizedValues, { enumType: "phandle" });
                    if (component) {
                        components.push(component);
                    }
                } else if (validationType?.type === "ArrayStringValidation" && validationType.enumType && validationType.enumType !== "string") {
                    const component = this.buildArrayComponent(normalizedValues, { enumType: validationType.enumType });
                    if (component) {
                        components.push(component);
                    }
                } else if (allStrings) {
                    const stringValues = normalizedValues as string[];
                    const allNumbers = stringValues.every((s) => this.isNumericLike(s));

                    if (allNumbers) {
                        const component = this.buildArrayComponent(stringValues);
                        if (component) {
                            components.push(component);
                        }
                    } else {
                        for (const entry of stringValues) {
                            components.push(dtsString(entry));
                        }
                    }
                } else {
                    const component = this.buildArrayComponent(element.setValue);
                    if (component) {
                        components.push(component);
                    }
                }

                if (components.length === 0) {
                    this.removeProperty(node, element.key);
                    break;
                }

                node.properties = node.properties.filter((property) => property.name !== element.key);
                node.properties.push({
                    name: element.key,
                    value: { components },
                    modified_by_user: true,
                    labels: [],
                    deleted: false,
                });
                node.modified_by_user = true;
                break;
            }
            case "FormMatrix": {
                // Only write to device tree if user explicitly set a value
                if (element.setValue === undefined) {
                    this.removeProperty(node, element.key);
                    break;
                }
                if (!Array.isArray(element.setValue)) {
                    this.removeProperty(node, element.key);
                    break;
                }
                const matrixValidation = element.validationType as MatrixValidation | undefined;
                const matrixDefinition = matrixValidation?.definition;
                const arrayOptions: { enumType?: EnumValueType; prefixItems?: ArrayMixedTypeValidation["prefixItems"] } = {};

                if (matrixDefinition?.type === "ArrayMixedTypeValidation") {
                    arrayOptions.prefixItems = matrixDefinition.prefixItems;
                } else if (matrixDefinition?.type === "ArrayStringValidation" && matrixDefinition.enumType) {
                    arrayOptions.enumType = matrixDefinition.enumType;
                }

                const components = element.setValue
                    .map((row) => Array.isArray(row) ? this.buildArrayComponent(row, arrayOptions) : undefined)
                    .filter((component): component is DtsValueComponent => component !== undefined);

                if (components.length === 0) {
                    this.removeProperty(node, element.key);
                    break;
                }

                node.properties = node.properties.filter((property) => property.name !== element.key);
                node.properties.push({
                    name: element.key,
                    value: { components },
                    modified_by_user: true,
                    labels: [],
                    deleted: false
                });
                node.modified_by_user = true;
                break;
            }
            default: {
                break;
            }
        }
    }

    private setNodeAlias(node: DtsNode, alias: string): void {
        if (!alias) {
            node.labels = [];
            node.modified_by_user = true;
            return;
        }

        node.labels = [alias];
        node.modified_by_user = true;
    }

    private setNodeActiveInternal(node: DtsNode, active: boolean): void {
        if (active) {
            this.enableParentChain(node);
        }

        this.setNodeStatus(node, active);
    }

    private enableParentChain(node: DtsNode): void {
        let current: DtsNode | undefined = node;

        while (current) {
            const parent = this.attachSession.find_parent_node_by_uuid(current._uuid);
            if (parent === undefined) {
                break;
            }

            if (DeviceState.getNodeActive(parent) === false) {
                this.setNodeStatus(parent, true);
            }

            current = parent;
        }
    }

    private setNodeStatus(node: DtsNode, active: boolean): void {
        const statusProperty = dtsStatusProperty(active);
        const existingIndex = node.properties.findIndex((p) => p.name === "status");
        if (existingIndex === -1) {
            node.properties.push(statusProperty);
        } else {
            node.properties[existingIndex] = statusProperty;
        }

        node.modified_by_user = true;
    }

    private buildValueComponent(value: unknown): DtsValueComponent | undefined {
        return dtsValueComponent(value);
    }

    private buildArrayComponent(
        values: unknown[],
        options?: {
            enumType?: EnumValueType;
            prefixItems?: ArrayMixedTypeValidation["prefixItems"];
        }
    ): DtsValueComponent | undefined {
        const elements: CellArrayElement[] = [];

        for (const [index, entry] of values.entries()) {
            const prefixItem = options?.prefixItems?.[index];
            const enumType = prefixItem?.type === "StringList" ? prefixItem.enumType : options?.enumType;
            const element = dtsCellElement(entry, { enumType: enumType as "phandle" | "macro" | "string" | undefined });
            if (!element) {
                continue;
            }
            elements.push(element);
        }

        if (elements.length === 0) {
            return undefined;
        }

        return dtsCellArray(elements);
    }

    private isNumericLike(value: string): boolean {
        return /^0x[0-9a-f]+$/i.test(value) || /^[+-]?\d+$/.test(value);
    }

    private removeProperty(node: DtsNode, key: string): void {
        node.properties = node.properties.filter((property) => property.name !== key);
        if (key === "reg") {
            node.unit_addr = undefined;
        }
        node.modified_by_user = true;
    }

    private upsertProperty(node: DtsNode, key: string, component?: DtsValueComponent): void {
        node.properties = node.properties.filter((property) => property.name !== key);
        const newProperty = component
            ? dtsProperty(key, component)
            : dtsFlagProperty(key);
        node.properties.push(newProperty);
        node.modified_by_user = true;
    }

    private removeChannelsIfMissing(
        deviceNode: DtsNode,
        channelElements: FormObjectElement[],
        compiledChannelRegexes: RegExp[]
    ): void {
        // Get the set of channel names that are present in the payload
        const payloadChannelNames = new Set(
            channelElements.map(element => element.channelName ?? element.key)
        );

        // Find existing channel child nodes that should be considered for removal
        const existingChannelNodes = deviceNode.children.filter((child) => {
            if (child.created_by_user !== true) {
                return false;
            }
            if (this.attachSession.isDeviceNode(child)) {
                return false;
            }

            // If there are no channel patterns, consider all user-created non-device nodes as channels
            if (compiledChannelRegexes.length === 0) {
                return true;
            }

            // If there are channel patterns, only consider nodes that match the patterns
            const nodeSegment = this.attachSession.buildNodeSegment(child);
            return this.matchesAnyChannelPattern(nodeSegment, compiledChannelRegexes);
        });

        // Remove channel nodes that are not present in the payload
        const channelsToRemove = existingChannelNodes.filter((child) => {
            const nodeSegment = this.attachSession.buildNodeSegment(child);
            return !payloadChannelNames.has(nodeSegment);
        });

        if (channelsToRemove.length > 0) {
            // Remove the channels from the device node's children
            deviceNode.children = deviceNode.children.filter((child) => !channelsToRemove.includes(child));
            deviceNode.modified_by_user = true;
        }
    }

    private findChildNode(node: DtsNode, key: string): DtsNode | undefined {
        return node.children.find((child) => {
            const childSegment = this.attachSession.buildNodeSegment(child);
            return childSegment === key;
        });
    }

    private getNodeAlias(node: DtsNode): string {
        return node.labels?.[0] ?? "";
    }

    private convertDtsNodeToFormElement(node: DtsNode): FormObjectElement {
        const config: FormElement[] = [];

        for (const property of node.properties) {
            if (property.name === "status") {
                continue;
            }

            const formElement = this.propertyToFormElement(property, false);
            if (formElement) {
                config.push(formElement);
            }
        }

        for (const child of node.children) {
            const childFormElement = this.convertDtsNodeToFormElement(child);
            config.push(childFormElement);
        }

        const key = node.name === "/" ? "root" : node.name;

        return {
            type: "FormObject",
            key,
            required: false,
            description: `Device tree node: ${key}`,
            config: config,
            alias: this.getNodeAlias(node),
            active: DeviceState.getNodeActive(node),
            deviceUID: node._uuid,
        };
    }

    /**
     * Clear all validation errors from form elements recursively.
     * Used before applying new validation errors.
     */
    private clearValidationErrors(elements: FormElement[]): void {
        for (const element of elements) {
            element.error = undefined;
            if (element.type === "FormObject") {
                this.clearValidationErrors(element.config);
            }
        }
    }

    /**
     * Apply validation errors to form elements by matching error property paths
     * to element keys and attaching ConfigurationItemError objects.
     */
    public applyValidationErrors(config: ConfigTemplatePayload, errors: BindingErrors[]): void {
        // This looks stupid :)))
        const elements = config.config.config;
        config.config.genericErrors = [];

        // clear all existing errors to prevent stale error accumulation
        this.clearValidationErrors(elements);

        // Update session's validation error count for compile-time warning
        this.attachSession.setValidationErrorCount(errors.length);

        for (const error of errors) {
            switch (error._t) {
                case "missing_required": {
                    const targetElement =
                        error.instance.length > 0 ?
                            this.findFormElementByPath(elements, [...error.instance, error.missing_property]) :
                            this.findFormElementByKey(elements, error.missing_property);
                    if (targetElement) {
                        targetElement.error = {
                            code: error._t,
                            message: error.msg ?? `Required property '${error.missing_property}' is missing`,
                            details: `Missing required property ${error.missing_property}`,
                        };
                    }
                    break;
                }
                case "number_limit": {
                    const targetElement = this.findFormElementByPath(elements, error.failed_property);
                    if (!targetElement) {
                        break;
                    }
                    if (!this.elementHasValue(targetElement)) {
                        break; // ignore optional fields with no value
                    }

                    targetElement.error = {
                        code: error._t,
                        message: error.msg ?? "Value is out of range",
                        details: `Provided number out of range for ${error.failed_property}: ${error.comparison} ${error.limit}`,
                    };
                    break;
                }
                case "failed_dependency": {
                    const targetElement = this.findFormElementByKey(elements, error.dependent_property);
                    if (targetElement && this.elementHasValue(targetElement)) {
                        targetElement.error = {
                            code: error._t,
                            message: `'${error.dependent_property}' requires '${error.missing_property}'`,
                            details: `Dependency not met for ${error.dependent_property}, missing ${error.missing_property}`,
                        };
                    }
                    break;
                }
                case "generic": {
                    // Attach generic errors at the top level; do not attempt to guess a target field
                    config.config.genericErrors.push({
                        code: error._t,
                        message: error.msg ?? "Validation failed",
                        details: error.origin,
                    });
                    break;
                }
            }
        }
    }

    /**
     * FIXME: The binding parser (narrow_object / narrow_array_object in Attach.ts) does not
     * handle all JSON Schema patterns correctly. For example:
     *   - Phandle properties with nested arrays ({type:"array", items:{type:"array"}}) fall
     *     through to the generic _t:"array" fallback, causing AJV "must be array" errors
     *     because the value shape doesn't match the schema's nested structure.
     *   - The schema sets additionalProperties:false, but standard DT properties like
     *     "status" and "reg" are not included in the schema's property list (they come
     *     from base DT schema $refs that are stripped during fixups), causing invalid
     *     "must NOT have additional properties" errors.
     * These errors are not actionable by the user, so we suppress them until the binding
     * parser properly supports these patterns.
     */
    private suppressUnsupportedErrors(errors: BindingErrors[]): BindingErrors[] {
        return errors.filter(error => {
            if (error._t !== "generic") {
                return true;
            }

            // Suppress "must be array" for adi,spi-engine — its schema has a nested
            // array pattern ({type:"array", items:{type:"array"}}) that narrow_array_object
            // does not handle. It falls through to _t:"array" with ArrayStringValidation,
            // causing AJV to reject the flat value shape.
            if (error.msg === "must be array" && error.origin && error.origin.includes("spi-engine")) {
                return false;
            }

            // Suppress "must NOT have additional properties" from standard DT props
            // not listed in the binding schema
            if (error.origin && /\/additionalProperties$/.test(error.origin)) {
                return false;
            }

            return true;
        });
    }

    /**
     * Find a form element by its key (top-level search).
     */
    private findFormElementByKey(elements: FormElement[], key: string): FormElement | undefined {
        for (const element of elements) {
            if (element.key === key) {
                return element;
            }
            // Also search within FormObject elements
            if (element.type === "FormObject") {
                const found = this.findFormElementByKey(element.config, key);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    private elementHasValue(element: FormElement): boolean {
        switch (element.type) {
            case "Flag":
            case "Generic": {
                return element.setValue !== undefined || element.defaultValue !== undefined;
            }
            case "FormArray": {
                return element.setValue !== undefined && Array.isArray(element.setValue) && element.setValue.length > 0;
            }
            case "FormMatrix": {
                return element.setValue !== undefined && Array.isArray(element.setValue) && element.setValue.length > 0;
            }
            case "FormObject": {
                return element.config.some((child) => this.elementHasValue(child));
            }
            default: {
                return false;
            }
        }
    }

    /**
     * Find a form element by property path (for nested properties).
     */
    private findFormElementByPath(elements: FormElement[], path: string[]): FormElement | undefined {
        if (path.length === 0) {
            return undefined;
        }

        if (path.length === 1) {
            return this.findFormElementByKey(elements, path[0]);
        }

        // Navigate through nested FormObjects
        const [first, ...rest] = path;
        for (const element of elements) {
            if (element.type === "FormObject" && (element.key === first || element.channelName === first)) {
                return this.findFormElementByPath(element.config, rest);
            }
        }

        return undefined;
    }
}
