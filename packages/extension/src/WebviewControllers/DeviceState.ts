import type {
    FormElement,
    GenericFormElement,
    FlagFormElement,
    FormArrayElement,
    FormMatrixElement,
    FormObjectElement,
    DeviceUID,
    NumericRangeValidation,
    ArrayNumberValidation,
    ArrayStringValidation,
    ArrayMixedTypeValidation,
    MatrixValidation,
    ArrayValidation,
    HyperlinkItem,
    DropdownValidation,
} from "extension-protocol";
import type {
    AttachType,
    BindingErrors,
    DtsNode,
    DtsProperty,
    DtsValueComponent,
    ParsedBinding,
} from "attach-lib";
import { AttachEnumType, value_to_macro } from "attach-lib";
import {
    dtsValueComponent,
    dtsMultipleStringComponents,
    dtsProperty,
    dtsStatusProperty,
    dtsNode,
} from "./DtsAstBuilders";
import type { AttachSession } from "../AttachSession/AttachSession";

/**
 * Custom property type designation for properties not from binding schema.
 */
export type CustomPropertyType = "text" | "flag" | "number" | "phandle";

/**
 * Represents the state of a single property within a device or channel.
 */
export interface PropertyState {
    /** Property key/name */
    key: string;

    /** Current property value */
    value: unknown;

    /** DTS serialization hint for numbers (hex vs decimal) */
    numberFormat?: "hex" | "dec";

    /** Whether this is a custom property (not from binding schema) */
    isCustom: boolean;

    /** Custom property type - only meaningful when isCustom is true */
    customType?: CustomPropertyType;

    /** Schema from binding - uses attach-lib AttachType directly */
    schema?: AttachType;

    /** Whether the property is required by the binding */
    required?: boolean;

    /** Validation error if any */
    error?: BindingErrors;
}

/**
 * Represents the state of a channel (child node matching channel patterns).
 */
export interface ChannelState {
    /** Channel name (node segment, e.g., "channel@0") */
    name: string;

    /** Channel alias (label) */
    alias?: string;

    /** Channel properties */
    properties: Map<string, PropertyState>;
}

/**
 * Describes an update operation for a property.
 */
export interface PropertyUpdate {
    action: "set" | "delete";
    key: string;
    value?: unknown;
    customType?: CustomPropertyType;

    /** For channel properties, the channel name */
    channelName?: string;
}

/**
 * DeviceState is the single source of truth for a device's configuration state.
 * It maintains the authoritative view of all properties, channels, and metadata,
 * independent of the DTS AST or FormElement representations.
 */
export class DeviceState {
    /** Unique identifier for this device node */
    uuid: DeviceUID;

    /** Device compatible string(s) - can be a single string or grouped array */
    compatible?: string | string[];

    /** Device alias (label) */
    alias?: string;

    /** Whether the device is active (status = okay) */
    active: boolean;

    /** Parent node UUID */
    parentUUID: DeviceUID;

    /** Parent node name */
    parentName: string;

    /** Full binding from attach-lib */
    binding?: ParsedBinding;

    /** Device-level properties */
    properties: Map<string, PropertyState>;

    /** Channel states (keyed by channel name/segment) */
    channels: Map<string, ChannelState>;

    /** Modified children - non-channel nodes with user modifications (keyed by segment) */
    modifiedChildren: Map<string, ChannelState>;

    /** Compiled channel pattern regexes */
    channelPatterns?: RegExp[];

    /** Raw channel regex patterns from binding */
    channelRegexStrings?: string[];

    /** Validation errors from the enriched binding */
    validationErrors: BindingErrors[];

    private constructor() {
        this.uuid = crypto.randomUUID();
        this.active = true;
        this.parentUUID = crypto.randomUUID();
        this.parentName = "";
        this.properties = new Map();
        this.channels = new Map();
        this.modifiedChildren = new Map();
        this.validationErrors = [];
    }

    /**
     * Create DeviceState from a DtsNode and its resolved binding.
     * The errors should be pre-filtered based on the enriched binding.
     */
    static fromNodeAndBinding(
        node: DtsNode,
        parentNode: DtsNode,
        binding: ParsedBinding | undefined,
        attachSession: AttachSession,
        channelPatterns: string[] = [],
        errors: BindingErrors[] = []
    ): DeviceState {
        const state = new DeviceState();
        state.uuid = node._uuid;
        state.alias = node.labels?.[0] ?? "";
        state.active = DeviceState.getNodeActive(node);
        state.parentUUID = parentNode._uuid;
        state.parentName = parentNode.name;
        state.binding = binding;
        state.validationErrors = errors;

        // Extract compatible - can be single string or grouped array
        const compatibleProperty = node.properties.find(p => p.name === "compatible");
        if (compatibleProperty?.value) {
            const parsed = attachSession.parseDtsValue(compatibleProperty.value);
            if (Array.isArray(parsed)) {
                // Grouped compatible: ["adi,adxl346", "adi,adxl345"]
                state.compatible = parsed.length === 1
                    ? String(parsed[0])
                    : parsed.map(String);
            } else {
                state.compatible = String(parsed);
            }
        }

        // Build lookup maps from binding and node
        const requiredKeys = new Set(binding?.required_properties ?? []);
        const nodePropertyMap = new Map<string, DtsProperty>();
        for (const property of node.properties) {
            if (property.name !== "status") {
                nodePropertyMap.set(property.name, property);
            }
        }

        // Compile channel patterns
        state.channelRegexStrings = channelPatterns;
        state.channelPatterns = channelPatterns
            .map(pattern => {
                try {
                    return new RegExp(pattern);
                } catch {
                    return;
                }
            })
            .filter((regex): regex is RegExp => regex !== undefined);

        // Process properties in binding order first (preserves attach-lib order)
        for (const bindingProperty of binding?.properties ?? []) {
            const nodeProperty = nodePropertyMap.get(bindingProperty.key);
            if (nodeProperty) {
                // Property exists in node - use node value with binding schema
                const propertyState = DeviceState.propertyFromDts(
                    nodeProperty,
                    bindingProperty.value,
                    requiredKeys.has(bindingProperty.key),
                    attachSession
                );
                state.properties.set(bindingProperty.key, propertyState);
                nodePropertyMap.delete(bindingProperty.key);
            } else {
                // Property only in binding - no value yet
                state.properties.set(bindingProperty.key, {
                    key: bindingProperty.key,
                    value: undefined,
                    isCustom: false,
                    schema: bindingProperty.value,
                    required: requiredKeys.has(bindingProperty.key),
                });
            }
        }

        // Add remaining node properties not in binding (custom properties)
        for (const [name, property] of nodePropertyMap) {
            const propertyState = DeviceState.propertyFromDts(
                property,
                undefined,
                false,
                attachSession
            );
            state.properties.set(name, propertyState);
        }

        // Process channels (children matching channel patterns) and touched children
        for (const child of node.children) {
            if (attachSession.isDeviceNode(child)) {
                continue;
            }

            const segment = attachSession.buildNodeSegment(child);
            const isChannel = state.channelPatterns.length === 0 ||
                state.channelPatterns.some(regex => regex.test(segment));

            // Check if this is a touched child (non-channel with user modifications)
            const isTouchedChild = !isChannel &&
                !child.created_by_user &&
                child.properties.some(p => p.modified_by_user === true);

            if (!isChannel && !isTouchedChild) {
                continue;
            }

            const channelState: ChannelState = {
                name: segment,
                alias: child.labels?.[0],
                properties: new Map(),
            };

            // Find matching pattern rule for channel schema
            const matchedRule = binding?.pattern_properties?.find(rule => {
                try {
                    return new RegExp(rule.pattern).test(segment);
                } catch {
                    return false;
                }
            });

            const channelSchemaMap = new Map<string, AttachType>();
            const channelRequiredKeys = new Set(matchedRule?.required ?? []);
            for (const ruleProperty of matchedRule?.properties ?? []) {
                channelSchemaMap.set(ruleProperty.key, ruleProperty.value);
            }

            for (const childProperty of child.properties) {
                if (childProperty.name === "status") {
                    continue;
                }

                const propertyState = DeviceState.propertyFromDts(
                    childProperty,
                    channelSchemaMap.get(childProperty.name),
                    channelRequiredKeys.has(childProperty.name),
                    attachSession
                );
                channelState.properties.set(childProperty.name, propertyState);
            }

            // Add pattern properties that don't exist yet (only for channels with matched rules)
            if (isChannel) {
                for (const patternProperty of matchedRule?.properties ?? []) {
                    if (!channelState.properties.has(patternProperty.key)) {
                        channelState.properties.set(patternProperty.key, {
                            key: patternProperty.key,
                            value: undefined,
                            isCustom: false,
                            schema: patternProperty.value,
                            required: channelRequiredKeys.has(patternProperty.key),
                        });
                    }
                }
                state.channels.set(segment, channelState);
            } else {
                // Touched child - non-channel with user modifications
                state.modifiedChildren.set(segment, channelState);
            }
        }

        return state;
    }

    /**
     * Create PropertyState from a DtsProperty.
     */
    private static propertyFromDts(
        dtsProperty: DtsProperty,
        schema: AttachType | undefined,
        required: boolean,
        attachSession: AttachSession
    ): PropertyState {
        let value: unknown = dtsProperty.value ? attachSession.parseDtsValue(dtsProperty.value) : true;
        // A property is custom if it has no schema from the binding.
        // We don't rely on modified_by_user because it's not preserved across file reloads.
        const isCustom = schema === undefined;

        let customType: CustomPropertyType | undefined = undefined;
        if (isCustom) {
            // Check DTS component kind to detect phandle refs (the parsed value won't have "&")
            // Phandles can be: top-level ref (&label) or array containing ref (<&label>)
            const firstComponent = dtsProperty.value?.components?.[0];
            const isPhandle = firstComponent?.kind === "ref" ||
                (firstComponent?.kind === "array" &&
                 firstComponent.elements.length === 1 &&
                 firstComponent.elements[0]?.item?.kind === "ref");
            customType = isPhandle ? "phandle" : DeviceState.inferCustomType(value);
        }

        // Detect number format from DTS
        let numberFormat: "hex" | "dec" | undefined;
        if (dtsProperty.value?.components?.[0]?.kind === "array") {
            const firstElement = dtsProperty.value.components[0].elements[0];
            if (firstElement?.item?.kind === "number" && firstElement.item.repr) {
                numberFormat = firstElement.item.repr;
            }
        }

        // Validate phandle values against schema enum - clear invalid values in memory
        if (schema && schema._t === "enum_array" && schema.enum_type === AttachEnumType.PHANDLE) {
            const enumSet = new Set((schema.enum ?? []).map(String));
            const normalized = Array.isArray(value) ? value : (value === undefined ? [] : [value]);
            const hasInvalid = normalized.some(v => !enumSet.has(String(v)));
            if (hasInvalid) {
                value = undefined; // Clear invalid phandle in memory
            }
        }

        return {
            key: dtsProperty.name,
            value,
            numberFormat,
            isCustom,
            customType,
            schema,
            required,
        };
    }

    /**
     * Infer custom property type from value.
     */
    private static inferCustomType(value: unknown): CustomPropertyType {
        if (typeof value === "boolean" || value === true) {
            return "flag";
        }
        if (typeof value === "number" || typeof value === "bigint") {
            return "number";
        }
        if (Array.isArray(value) && value.length === 1) {
            const first = value[0];
            if (typeof first === "number" || typeof first === "bigint") {
                return "number";
            }
        }
        if (typeof value === "string" && value.startsWith("&")) {
            return "phandle";
        }
        return "text";
    }

    /**
     * Get the active status from a DtsNode.
     */
    private static getNodeActive(node: DtsNode): boolean {
        const statusProperty = node.properties.find(p => p.name === "status");
        if (!statusProperty?.value?.components?.length) {
            return true;
        }
        const component = statusProperty.value.components[0];
        if (component.kind !== "string") {
            return true;
        }
        return component.value !== "disabled";
    }

    /**
     * Apply property updates to this DeviceState.
     */
    applyUpdates(updates: PropertyUpdate[]): void {
        for (const update of updates) {
            if (update.channelName) {
                // Channel property update
                let channel = this.channels.get(update.channelName);
                if (!channel && update.action === "set") {
                    // Create new channel
                    channel = {
                        name: update.channelName,
                        properties: new Map(),
                    };
                    this.channels.set(update.channelName, channel);
                }

                if (channel) {
                    if (update.action === "set") {
                        const existing = channel.properties.get(update.key);
                        if (existing) {
                            existing.value = update.value;
                            if (update.customType) {
                                existing.customType = update.customType;
                                existing.isCustom = true;
                            }
                        } else {
                            channel.properties.set(update.key, {
                                key: update.key,
                                value: update.value,
                                isCustom: true,
                                customType: update.customType ?? DeviceState.inferCustomType(update.value),
                            });
                        }
                    } else if (update.action === "delete") {
                        channel.properties.delete(update.key);
                    }
                }
            } else {
                // Device-level property update
                if (update.action === "set") {
                    const existing = this.properties.get(update.key);
                    if (existing) {
                        existing.value = update.value;
                        if (update.customType) {
                            existing.customType = update.customType;
                            existing.isCustom = true;
                        }
                    } else {
                        this.properties.set(update.key, {
                            key: update.key,
                            value: update.value,
                            isCustom: true,
                            customType: update.customType ?? DeviceState.inferCustomType(update.value),
                        });
                    }
                } else if (update.action === "delete") {
                    this.properties.delete(update.key);
                }
            }
        }
    }

    /**
     * Convert DeviceState to FormElement[] for the frontend.
     *
     * @param attachSession The attach session for label lookups
     * @param options Optional settings for serialization
     *   - serializeForFrontend: Convert BigInt values to numbers for JSON serialization
     */
    toFormElements(attachSession: AttachSession, options?: { serializeForFrontend?: boolean }): FormElement[] {
        const elements: FormElement[] = [];

        // Device-level properties
        for (const [, propertyState] of this.properties) {
            const element = this.propertyStateToFormElement(propertyState, attachSession);
            if (element) {
                elements.push(element);
            }
        }

        // Modified children (non-channel, user-modified children) - placed before channels
        for (const [, modifiedState] of this.modifiedChildren) {
            const modifiedElement = this.modifiedChildToFormElement(modifiedState, attachSession);
            elements.push(modifiedElement);
        }

        // Channel elements
        for (const [, channelState] of this.channels) {
            const channelElement = this.channelStateToFormElement(channelState, attachSession);
            elements.push(channelElement);
        }

        // Convert BigInts to numbers for JSON serialization if requested
        if (options?.serializeForFrontend) {
            return this.convertBigIntsToNumbers(elements);
        }

        return elements;
    }

    /**
     * Deep clone and convert all BigInt values to numbers for JSON serialization.
     */
    private convertBigIntsToNumbers(elements: FormElement[]): FormElement[] {
        const convertValue = (value: unknown): unknown => {
            if (typeof value === "bigint") {
                return Number(value);
            }
            if (Array.isArray(value)) {
                return value.map(v => convertValue(v));
            }
            if (value !== null && typeof value === "object") {
                const result: Record<string, unknown> = {};
                for (const [key, value_] of Object.entries(value)) {
                    result[key] = convertValue(value_);
                }
                return result;
            }
            return value;
        };

        const convertElement = (element: FormElement): FormElement => {
            const cloned = { ...element };

            // Convert setValue and defaultValue
            if ("setValue" in cloned) {
                (cloned as any).setValue = convertValue((cloned as any).setValue);
            }
            if ("defaultValue" in cloned) {
                (cloned as any).defaultValue = convertValue((cloned as any).defaultValue);
            }

            // Convert validation type values
            if ("validationType" in cloned && cloned.validationType) {
                (cloned as any).validationType = convertValue(cloned.validationType);
            }

            // Recurse into FormObject config
            if (cloned.type === "FormObject") {
                cloned.config = cloned.config.map(_element => convertElement(_element));
            }

            return cloned;
        };

        return elements.map(_element => convertElement(_element));
    }

    /**
     * Convert a PropertyState to a FormElement.
     */
    private propertyStateToFormElement(
        propertyState: PropertyState,
        attachSession: AttachSession
    ): FormElement | undefined {
        // If we have a schema, use it to determine form element type
        if (propertyState.schema) {
            return this.schemaToFormElement(propertyState, attachSession);
        }

        // Custom property handling
        if (propertyState.isCustom) {
            return this.customPropertyToFormElement(propertyState);
        }

        // Fallback: infer from value
        return this.inferFormElement(propertyState);
    }

    /**
     * Convert a schema-backed property to FormElement.
     */
    private schemaToFormElement(
        propertyState: PropertyState,
        attachSession: AttachSession
    ): FormElement {
        const dto = propertyState.schema!;
        const overrideValue = propertyState.value;
        const required = propertyState.required ?? false;

        switch (dto._t) {
            case "enum_integer": {
                return {
                    type: "Generic",
                    key: propertyState.key,
                    inputType: "dropdown",
                    required,
                    description: dto.description,
                    defaultValue: dto.default,
                    setValue: this.normalizeScalar(overrideValue),
                    validationType: {
                        list: dto.enum as unknown as bigint[],
                        type: "DropdownValidation",
                    },
                } satisfies GenericFormElement;
            }
            case "enum_array": {
                const normalizeGroupedStrings = (value: unknown): Array<string | string[]> | undefined => {
                    const values = this.normalizeArray(value);
                    if (!values) {return undefined;}
                    return values.map(entry => Array.isArray(entry) ? entry.map(String) : String(entry));
                };

                let validationType: ArrayValidation;
                validationType = dto.enum_type === AttachEnumType.PHANDLE ? {
                        type: "ArrayHyperlinkValidation",
                        minLength: dto.minItems,
                        maxLength: dto.maxItems,
                        enum: this.normalizeArray(dto.enum)?.map((item): HyperlinkItem => {
                            const itemString = String(item);
                            const labelPath = attachSession.get_label_map().get(itemString);
                            const gotoUID = attachSession.path_to_uuid(labelPath ?? itemString);
                            return {
                                type: "HyperlinkItem",
                                name: itemString,
                                gotoUID,
                            };
                        }),
                    } : {
                        type: "ArrayStringValidation",
                        minLength: dto.minItems,
                        maxLength: dto.maxItems,
                        enum: normalizeGroupedStrings(dto.enum),
                        enumType: dto.enum_type,
                    };

                const defaultValue = normalizeGroupedStrings(dto.default);
                let setValue = overrideValue === undefined ? undefined : normalizeGroupedStrings(overrideValue);

                // Convert numeric values to macro names for each element in the array
                if (dto.enum_type === AttachEnumType.MACRO && setValue && dto.enum) {
                    setValue = this.convertArrayToMacros(setValue, dto.enum);
                }

                return {
                    type: "FormArray",
                    key: propertyState.key,
                    required,
                    description: dto.description,
                    defaultValue,
                    setValue,
                    validationType,
                } satisfies FormArrayElement;
            }
            case "number_array": {
                const validationType: ArrayNumberValidation = {
                    type: "ArrayNumberValidation",
                    minLength: dto.minItems,
                    maxLength: dto.maxItems,
                    minValue: dto.minimum,
                    maxValue: dto.maximum,
                };

                return {
                    type: "FormArray",
                    key: propertyState.key,
                    required,
                    description: dto.description,
                    setValue: this.normalizeArray(overrideValue),
                    validationType,
                } satisfies FormArrayElement;
            }
            case "string_array":
            case "array": {
                const validationType: ArrayStringValidation = {
                    type: "ArrayStringValidation",
                    minLength: dto.minItems,
                    maxLength: dto.maxItems,
                };

                return {
                    type: "FormArray",
                    key: propertyState.key,
                    required,
                    description: dto.description,
                    setValue: this.normalizeArray(overrideValue),
                    validationType,
                } satisfies FormArrayElement;
            }
            case "fixed_index": {
                const validationType: ArrayMixedTypeValidation = {
                    type: "ArrayMixedTypeValidation",
                    minPrefixItems: dto.minItems,
                    maxPrefixItems: dto.maxItems,
                    prefixItems: [],
                };

                const overrideArray = Array.isArray(overrideValue) ? [...overrideValue] : undefined;

                for (const [index, item] of dto.prefixItems.entries()) {
                    switch (item._t) {
                        case "enum": {
                            if (item.enum_type === AttachEnumType.MACRO && overrideArray) {
                                const raw = overrideArray[index];
                                if (!item.enum.includes(raw)) {
                                    const name = value_to_macro(Number(raw), item.enum);
                                    if (name !== undefined) {
                                        overrideArray[index] = name;
                                    }
                                }
                            }
                            validationType.prefixItems.push({
                                type: "StringList",
                                enum: item.enum,
                                enumType: item.enum_type,
                            });
                            break;
                        }
                        case "number": {
                            validationType.prefixItems.push({
                                type: "Number",
                                minValue: item.minimum ?? 0n,
                                maxValue: item.maximum ?? BigInt(Number.MAX_SAFE_INTEGER),
                            });
                            break;
                        }
                    }
                }

                return {
                    type: "FormArray",
                    key: propertyState.key,
                    required,
                    description: dto.description,
                    setValue: overrideArray,
                    validationType,
                } satisfies FormArrayElement;
            }
            case "matrix": {
                const normalizeMatrixValue = (value: unknown): unknown[][] | undefined => {
                    if (!Array.isArray(value)) {return undefined;}
                    if (!Array.isArray(value[0])) {return [value];}
                    return value as unknown[][];
                };

                const validationType: MatrixValidation = {
                    minRows: dto.minItems,
                    maxRows: dto.maxItems,
                    definition: {
                        type: "ArrayMixedTypeValidation",
                        minPrefixItems: dto.minItems,
                        maxPrefixItems: dto.maxItems,
                        prefixItems: [],
                    },
                };

                for (const value of dto.values) {
                    switch (value._t) {
                        case "enum_array": {
                            validationType.definition = {
                                type: "ArrayStringValidation",
                                minLength: value.minItems,
                                maxLength: value.maxItems,
                                enum: value.enum,
                                enumType: value.enum_type,
                            };
                            break;
                        }
                        case "number_array": {
                            validationType.definition = {
                                type: "ArrayNumberValidation",
                                minLength: value.minItems,
                                maxLength: value.maxItems,
                                minValue: value.minimum,
                                maxValue: value.maximum,
                            };
                            break;
                        }
                        case "array": {
                            validationType.definition = {
                                type: "ArrayNumberValidation",
                                minLength: value.minItems,
                                maxLength: value.maxItems,
                            };
                            break;
                        }
                        case "fixed_index": {
                            const validations: ArrayMixedTypeValidation = {
                                type: "ArrayMixedTypeValidation",
                                minPrefixItems: value.minItems,
                                maxPrefixItems: value.maxItems,
                                prefixItems: [],
                            };

                            for (const item of value.prefixItems) {
                                switch (item._t) {
                                    case "enum": {
                                        validations.prefixItems.push({
                                            type: "StringList",
                                            enum: item.enum,
                                            enumType: item.enum_type,
                                        });
                                        break;
                                    }
                                    case "number": {
                                        validations.prefixItems.push({
                                            type: "Number",
                                            minValue: item.minimum,
                                            maxValue: item.maximum,
                                        });
                                        break;
                                    }
                                }
                            }
                            validationType.definition = validations;
                            break;
                        }
                    }
                }

                let setValue = normalizeMatrixValue(overrideValue);

                // Trim values to match shape constraints
                if (setValue) {
                    const maxCols = validationType.definition.type === "ArrayMixedTypeValidation"
                        ? validationType.definition.maxPrefixItems
                        : validationType.definition.maxLength;

                    if (maxCols !== undefined) {
                        setValue = setValue.map(row => row.slice(0, maxCols));
                    }
                    if (validationType.maxRows !== undefined) {
                        setValue = setValue.slice(0, validationType.maxRows);
                    }
                }

                // Convert numeric values to macro names for matrix cells
                const definition = validationType.definition;
                if (setValue && (definition.type === "ArrayStringValidation" || definition.type === "ArrayMixedTypeValidation")) {
                    setValue = this.convertMatrixToMacros(setValue, definition);
                }

                return {
                    type: "FormMatrix",
                    key: propertyState.key,
                    required,
                    description: dto.description,
                    setValue,
                    validationType,
                } satisfies FormMatrixElement;
            }
            case "boolean": {
                return {
                    type: "Flag",
                    key: propertyState.key,
                    required,
                    defaultValue: false,
                    setValue: overrideValue as boolean | undefined,
                    description: dto.description,
                } satisfies FlagFormElement;
            }
            case "integer": {
                const validationType: NumericRangeValidation = {
                    minValue: dto.minimum,
                    maxValue: dto.maximum,
                    type: "NumericRangeValidation",
                };

                return {
                    type: "Generic",
                    key: propertyState.key,
                    inputType: "number",
                    required,
                    description: dto.description,
                    defaultValue: dto.default,
                    setValue: this.normalizeScalar(overrideValue),
                    validationType,
                } satisfies GenericFormElement;
            }
            case "const": {
                const validationType: DropdownValidation = {
                    type: "DropdownValidation",
                    list: [dto.const],
                };

                return {
                    type: "Generic",
                    key: propertyState.key,
                    inputType: "dropdown",
                    required,
                    description: dto.description,
                    validationType,
                    setValue: this.normalizeScalar(overrideValue),
                } satisfies GenericFormElement;
            }
            case "generic": {
                return {
                    type: "Generic",
                    key: propertyState.key,
                    inputType: "text",
                    required,
                    description: dto.description,
                    setValue: overrideValue,
                } satisfies GenericFormElement;
            }
            case "object": {
                const config: FormElement[] = [];
                for (const property of dto.properties) {
                    const childPropertyState: PropertyState = {
                        key: property.key,
                        value: undefined,
                        isCustom: false,
                        schema: property.value,
                    };
                    const element = this.schemaToFormElement(childPropertyState, attachSession);
                    config.push(element);
                }

                return {
                    type: "FormObject",
                    key: propertyState.key,
                    required,
                    config,
                } satisfies FormObjectElement;
            }
            default: {
                const _exhaustive: never = dto;
                throw new Error(`Unhandled schema type: ${(dto as { _t: string })._t}`);
            }
        }
    }

    /**
     * Convert a custom property to FormElement.
     */
    private customPropertyToFormElement(propertyState: PropertyState): FormElement {
        const { key, value, customType, required = false } = propertyState;

        switch (customType) {
            case "flag": {
                return {
                    type: "Generic",
                    key,
                    inputType: "custom-flag",
                    required,
                    setValue: value === true ? true : value,
                } satisfies GenericFormElement;
            }
            case "number": {
                const numberValue = Array.isArray(value) ? Number(value[0]) : Number(value);
                return {
                    type: "Generic",
                    key,
                    inputType: "custom-number",
                    required,
                    setValue: numberValue,
                } satisfies GenericFormElement;
            }
            case "phandle": {
                return {
                    type: "Generic",
                    key,
                    inputType: "custom-phandle",
                    required,
                    setValue: value,
                } satisfies GenericFormElement;
            }
            default: {
                // "text" and any other custom type
                return {
                    type: "Generic",
                    key,
                    inputType: "custom",
                    required,
                    setValue: value,
                } satisfies GenericFormElement;
            }
        }
    }

    /**
     * Infer FormElement from property value when no schema or custom type.
     */
    private inferFormElement(propertyState: PropertyState): FormElement {
        const { key, value, required = false } = propertyState;

        if (value === undefined || value === true) {
            return {
                type: "Flag",
                key,
                required,
                defaultValue: false,
                setValue: value,
            } satisfies FlagFormElement;
        }

        if (Array.isArray(value)) {
            return {
                type: "FormArray",
                key,
                required,
                setValue: value,
                defaultValue: [],
            } satisfies FormArrayElement;
        }

        return {
            type: "Generic",
            key,
            inputType: "text",
            required,
            setValue: value,
        } satisfies GenericFormElement;
    }

    /**
     * Convert a ChannelState to FormObjectElement.
     */
    private channelStateToFormElement(
        channelState: ChannelState,
        attachSession: AttachSession
    ): FormObjectElement {
        const config: FormElement[] = [];

        for (const [, propertyState] of channelState.properties) {
            const element = this.propertyStateToFormElement(propertyState, attachSession);
            if (element) {
                config.push(element);
            }
        }

        return {
            type: "FormObject",
            key: channelState.name,
            channelName: channelState.name,
            required: false,
            alias: channelState.alias,
            config,
        };
    }

    /**
     * Convert a modified child (non-channel) to FormObjectElement.
     * Unlike channels, these don't have channelName set.
     */
    private modifiedChildToFormElement(
        modifiedState: ChannelState,
        attachSession: AttachSession
    ): FormObjectElement {
        const config: FormElement[] = [];

        for (const [, propertyState] of modifiedState.properties) {
            const element = this.propertyStateToFormElement(propertyState, attachSession);
            if (element) {
                config.push(element);
            }
        }

        return {
            type: "FormObject",
            key: modifiedState.name,
            required: false,
            config,
        };
    }

    /**
     * Convert DeviceState to plain JSON structure for attach-lib validation.
     */
    toAttachLibJson(): Record<string, unknown> {
        const result: Record<string, unknown> = {};

        const normalizeValue = (value: unknown): unknown => {
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
                return Number(value);
            }
            if (Array.isArray(value)) {
                return value.map(element => normalizeValue(element));
            }
            return value;
        };

        // Device-level properties
        for (const [key, propertyState] of this.properties) {
            if (propertyState.value === undefined || propertyState.value === null) {continue;}
            if (typeof propertyState.value === "number" && Number.isNaN(propertyState.value)) {continue;}

            result[key] = normalizeValue(propertyState.value);
        }

        // Channels as nested objects
        for (const [channelName, channelState] of this.channels) {
            const channelObject: Record<string, unknown> = {};

            for (const [key, propertyState] of channelState.properties) {
                if (propertyState.value === undefined || propertyState.value === null) {continue;}
                channelObject[key] = normalizeValue(propertyState.value);
            }

            if (Object.keys(channelObject).length > 0) {
                result[channelName] = channelObject;
            }
        }

        return result;
    }

    /**
     * Sync DeviceState back to a DtsNode AST.
     */
    syncToDtsNode(node: DtsNode, attachSession: AttachSession): void {
        // Update alias
        node.labels = this.alias ? [this.alias] : [];
        node.modified_by_user = true;

        // Update status property
        this.syncStatusProperty(node);

        // Build set of property keys from DeviceState
        const statePropertyKeys = new Set(this.properties.keys());

        // Remove properties not in DeviceState (except status)
        node.properties = node.properties.filter(p => {
            if (p.name === "status") {return true;}
            return statePropertyKeys.has(p.name);
        });

        // Update/add properties
        for (const [key, propertyState] of this.properties) {
            if (propertyState.value === undefined) {
                // Remove the property if it exists
                node.properties = node.properties.filter(p => p.name !== key);
                continue;
            }

            const components = this.buildValueComponents(propertyState);
            if (components.length === 0 && propertyState.value !== true) {
                continue;
            }

            // Remove existing and add new
            node.properties = node.properties.filter(p => p.name !== key);
            const newProperty = components.length > 0
                ? dtsProperty(key, ...components)
                : dtsProperty(key);
            node.properties.push(newProperty);
        }

        // Sync channels
        const stateChannelNames = new Set(this.channels.keys());

        // Remove channel nodes not in DeviceState
        node.children = node.children.filter(child => {
            if (attachSession.isDeviceNode(child)) {return true;}
            const segment = attachSession.buildNodeSegment(child);
            return stateChannelNames.has(segment);
        });

        // Update/add channel nodes
        for (const [channelName, channelState] of this.channels) {
            let channelNode = node.children.find(child => {
                const segment = attachSession.buildNodeSegment(child);
                return segment === channelName;
            });

            if (!channelNode) {
                // Create new channel node
                const [name, unitAddr] = channelName.split("@", 2);
                channelNode = dtsNode({
                    name,
                    unitAddr,
                    labels: channelState.alias ? [channelState.alias] : [],
                });
                node.children.push(channelNode);
            }

            // Update channel alias
            if (channelState.alias) {
                channelNode.labels = [channelState.alias];
            }

            // Sync channel properties
            const channelPropertyKeys = new Set(channelState.properties.keys());
            channelNode.properties = channelNode.properties.filter(p => {
                if (p.name === "status") {return true;}
                return channelPropertyKeys.has(p.name);
            });

            for (const [key, propertyState] of channelState.properties) {
                if (propertyState.value === undefined) {
                    channelNode.properties = channelNode.properties.filter(p => p.name !== key);
                    continue;
                }

                const components = this.buildValueComponents(propertyState);
                if (components.length === 0 && propertyState.value !== true) {
                    continue;
                }

                channelNode.properties = channelNode.properties.filter(p => p.name !== key);
                const newProperty = components.length > 0
                    ? dtsProperty(key, ...components)
                    : dtsProperty(key);
                channelNode.properties.push(newProperty);
            }

            channelNode.modified_by_user = true;
        }
    }

    /**
     * Sync the status property based on active state.
     */
    private syncStatusProperty(node: DtsNode): void {
        const statusProperty = dtsStatusProperty(this.active);
        const existingIndex = node.properties.findIndex(p => p.name === "status");
        if (existingIndex === -1) {
            node.properties.push(statusProperty);
        } else {
            node.properties[existingIndex] = statusProperty;
        }
    }

    /**
     * Build DtsValueComponents from a PropertyState.
     * Handles grouped string arrays (like grouped compatibles) as multiple string components.
     * Returns an array of components.
     */
    private buildValueComponents(propertyState: PropertyState): DtsValueComponent[] {
        const value = propertyState.value;

        // Handle grouped string arrays (like grouped compatibles)
        if (Array.isArray(value) && value.every(v => typeof v === "string")) {
            return dtsMultipleStringComponents(value as string[]);
        }

        // Single component fallback
        const component = dtsValueComponent(value, { numberFormat: propertyState.numberFormat });
        return component ? [component] : [];
    }

    /**
     * Get validation errors and apply them to properties.
     * Returns the stored validation errors that were computed during creation
     * against the enriched binding (no false positives from raw schema).
     */
    validate(): BindingErrors[] {
        // Apply stored errors to DeviceState properties
        this.applyErrors(this.validationErrors);
        return this.validationErrors;
    }

    /**
     * Update the stored validation errors.
     * Called when errors are recomputed (e.g., after configuration update).
     */
    setValidationErrors(errors: BindingErrors[]): void {
        this.validationErrors = errors;
        this.applyErrors(errors);
    }

    /**
     * Clear all validation errors from properties.
     */
    clearErrors(): void {
        for (const [, propertyState] of this.properties) {
            propertyState.error = undefined;
        }
        for (const [, channelState] of this.channels) {
            for (const [, propertyState] of channelState.properties) {
                propertyState.error = undefined;
            }
        }
    }

    /**
     * Apply validation errors to the appropriate PropertyState.
     */
    applyErrors(errors: BindingErrors[]): void {
        this.clearErrors();

        for (const error of errors) {
            switch (error._t) {
                case "missing_required": {
                    if (error.instance.length > 0) {
                        // Channel property
                        const channelName = error.instance[0];
                        const channel = this.channels.get(channelName);
                        if (channel) {
                            const property = channel.properties.get(error.missing_property);
                            if (property) {
                                property.error = error;
                            }
                        }
                    } else {
                        // Device-level property
                        const property = this.properties.get(error.missing_property);
                        if (property) {
                            property.error = error;
                        }
                    }
                    break;
                }
                case "number_limit": {
                    const path = error.failed_property;
                    if (path.length === 1) {
                        const property = this.properties.get(path[0]);
                        if (property) {
                            property.error = error;
                        }
                    } else if (path.length >= 2) {
                        const channelName = path[0];
                        const propertyKey = path.at(-1);
                        const channel = this.channels.get(channelName);
                        if (channel && propertyKey) {
                            const property = channel.properties.get(propertyKey);
                            if (property) {
                                property.error = error;
                            }
                        }
                    }
                    break;
                }
                case "failed_dependency": {
                    const property = this.properties.get(error.dependent_property);
                    if (property) {
                        property.error = error;
                    }
                    break;
                }
                case "generic": {
                    // Generic errors are not attached to specific properties
                    break;
                }
            }
        }
    }

    // Helper methods
    private normalizeArray<T>(value: T): T[] | undefined {
        if (Array.isArray(value)) {return value;}
        if (value === undefined) {return undefined;}
        return [value];
    }

    private normalizeScalar(value: unknown): unknown {
        if (Array.isArray(value) && value.length === 1) {
            return value[0];
        }
        return value;
    }

    /**
     * Convert a single value to its macro name if it's a numeric value.
     * Returns the original value if conversion is not needed or fails.
     */
    private convertValueToMacro(value: unknown, enumValues: unknown[]): unknown {
        const valueString = String(value);
        const enumStrings = enumValues.map(String);
        // Check if already a valid enum string
        if (enumStrings.includes(valueString)) {
            return valueString;
        }
        // Try to convert numeric value to macro name
        const numberValue = Number(value);
        if (!Number.isNaN(numberValue)) {
            const name = value_to_macro(numberValue, enumStrings);
            if (name !== undefined) {
                return String(name);
            }
        }
        return value;
    }

    /**
     * Convert array values to macro names for arrays with macro enum type.
     * Handles both 1D arrays and grouped string arrays.
     */
    private convertArrayToMacros<T>(
        values: T[],
        enumValues: unknown[]
    ): T[] {
        return values.map(value => {
            if (Array.isArray(value)) {
                // Grouped strings - return as-is
                return value as T;
            }
            return this.convertValueToMacro(value, enumValues) as T;
        });
    }

    /**
     * Convert matrix (2D array) values to macro names based on column definitions.
     * Supports both ArrayStringValidation (all columns same type) and
     * ArrayMixedTypeValidation (per-column type definitions).
     */
    private convertMatrixToMacros(
        matrix: unknown[][],
        definition: ArrayStringValidation | ArrayMixedTypeValidation
    ): unknown[][] {
        return matrix.map(row => {
            return row.map((cell, colIndex) => {
                if (definition.type === "ArrayStringValidation") {
                    // All columns have the same enum type
                    if (definition.enumType === AttachEnumType.MACRO && definition.enum) {
                        return this.convertValueToMacro(cell, definition.enum);
                    }
                } else if (definition.type === "ArrayMixedTypeValidation") {
                    // Per-column type definitions
                    const columnDefinitions = definition.prefixItems[colIndex];
                    if (columnDefinitions?.type === "StringList" &&
                        columnDefinitions.enumType === AttachEnumType.MACRO &&
                        columnDefinitions.enum
                    ) {
                        return this.convertValueToMacro(cell, columnDefinitions.enum);
                    }
                }
                return cell;
            });
        });
    }
}
