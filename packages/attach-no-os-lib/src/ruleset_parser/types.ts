import {
	PrimitiveCType
} from "./primitive_c_types";

export type PropertyBase = {
	name: string,
	description: string,
	required?: boolean
	disabled?: boolean, // NOTE: default is disabled: false
	value?: any,
	capability?: string[], // Platform capabilities required for this property
	_platform_disabled?: boolean, // Internal: set by resolver when capability is missing, not parsed from ruleset
}

export type PrimitiveSymbol = PrimitiveCType["symbol"];

export const PRIMITIVE_SYMBOLS: PrimitiveSymbol[] = [
	"uint8_t", "uint16_t", "uint32_t", "uint64_t",
	"int8_t", "int16_t", "int32_t", "int64_t",
	"size_t"
];

// TODO : Rename this, bool is separate primitive
export function is_primitive_symbols(s: string): s is PrimitiveSymbol {
	return (PRIMITIVE_SYMBOLS as readonly string[]).includes(s);
}

export type NumberProperty<S extends PrimitiveSymbol = PrimitiveSymbol> = PropertyBase & {
	_t: "NumberProperty",
	type: S,
	minimum?: number,
	maximum?: number,
	default?: number
};

export type BooleanProperty = PropertyBase & {
	_t: "BooleanProperty",
	type: "bool",
	default: boolean
}

export type StringProperty = PropertyBase & {
	_t: "StringProperty",
	type: "string",
	default?: string,
}

export type IncludeProperty = PropertyBase & {
	_t: "IncludeProperty",
	include: string,
	pointer?: boolean,
}

export type EnumValue = string | number;

export type EnumProperty = PropertyBase & {
	_t: "EnumProperty",
	values: EnumValue[],
	default?: EnumValue,
}

export type UnionProperty = PropertyBase & {
	_t: "UnionProperty",
	members: IncludeProperty[]
}

export type PlatformOpsProperty = PropertyBase & {
    _t: "PlatformOpsProperty",
    type: "platform_ops",
    target: string,
    allowed?: string[], // NOTE: Set by override only
}

export type PlatformExtraProperty = PropertyBase & {
    _t: "PlatformExtraProperty",
    type: "platform_extra",
    allowed?: string[], // NOTE: Set by override only
}

export type CallbackFunctionProperty = PropertyBase & {
    _t: "CallbackFunctionProperty",
    type: "callback_func",
    signature: string,
    default?: string,
}

export type CallbackContextProperty = PropertyBase & {
    _t: "CallbackContextProperty",
    type: "callback_ctx",
    default?: string,
}

export type ArrayElement = NumberProperty | BooleanProperty | EnumProperty | IncludeProperty;

export type ArrayProperty = PropertyBase & {
	_t: "ArrayProperty",
	size: number,
	element: ArrayElement,
}

export type Property = NumberProperty | BooleanProperty | StringProperty | IncludeProperty | EnumProperty | UnionProperty | ArrayProperty | PlatformOpsProperty | PlatformExtraProperty | CallbackFunctionProperty | CallbackContextProperty;

export type TargetOverride = {
	_t: "TargetOverride",
	scope: OverrideScope,
	target: string, // prop name
	override: PropertyOverride
}

export type SwitchCase = {
	_t: "SwitchCase",
	condition: string,
	overrides: TargetOverride[]
}

export type OverrideSwitch = {
	_t: "OverrideSwitch",
	scope: OverrideScope,
	$on: string,
	$cases: SwitchCase[],
}

export type OverrideCondition = {
	scope: OverrideScope,
	target: string,
	value: unknown // FIXME: Does this need to be unknown?
}

export type OverrideIfThen = {
	_t: "OverrideIfThen",
	scope: OverrideScope,
	condition: OverrideCondition,
	overrides: TargetOverride[],
}

export type OverrideMutex = {
	_t: "OverrideMutex",
	scope: OverrideScope,
	properties: string[]
}

export type OverrideStatic = {
	_t: "OverrideStatic",
	scope: OverrideScope,
	target: string,
	override: PropertyOverride
}

export type PropertyOverride<T extends Property = Property> = Partial<Omit<T, '_t' | 'type' | 'name'>>;

export type OverrideScope = "$parent" | "$this";

export type OverrideDirective = OverrideSwitch | OverrideIfThen | OverrideStatic | OverrideMutex;

// TODO: Figure out how to specify the spi/i2c etc types, these are too generic
export enum RulesetType {
	RT_STRUCT = "bt_struct",
	RT_ENUM = "bt_enum",
	RT_PLATFORM_OPS = "bt_platform_ops",
	RT_DEVICE = "bt_device",
};

enum RulesetRank {
	RR_PRODUCTION = 0, // Deployed in shipping products/apps, hardware validated across all variants
	RR_VALIDATED = 1, // Developer reviewed, tested on real hardware
	RR_REVIEWED = 2, // Human reviewed, schema validates, basic tests
	RR_GENERATED = 3, // Auto/AI generated, validates, but minimally tested
	RR_DRAFT = 4, // Experimental, may not fully validate
};

export type RulesetHeaderSources = {
	headers?: string[],
	sources?: string[],
};

export type RulesetSources = RulesetHeaderSources & {
	noos?: string[],
	platform?: string[],
	project?: string[],
	sdk?: string[],
	$note?: string
};

export type RulesetEnumValue = {
	name: string | number,
	description?: string,
};

type RulesetBase = {
	_t: string,
	$id: string,
	$type: RulesetType,
	$symbol: string,
	$description: string,
	$ranking: RulesetRank,
	$sources: RulesetSources,
	// TODO: add something like maintainer or edited_by?
}

export type RulesetEnum = RulesetBase & {
	_t: "RulesetEnum",
	$type: RulesetType.RT_ENUM,
	values: RulesetEnumValue[],
	default?: string,
};

export type RulesetStruct = RulesetBase & {
	_t: "RulesetStruct",
	$type: RulesetType.RT_STRUCT,
	properties: Property[],
	$override?: OverrideDirective[],
	$requires?: string[], // Auto-computed: all capabilities required by properties
	$capability?: string,
};

export type RulesetDevice = RulesetBase & {
	_t: "RulesetDevice",
	$type: RulesetType.RT_DEVICE,
	properties: Property[],
	$override?: OverrideDirective[],
	$requires?: string[],
	$capability?: string,
	// Required device fields
	$init_function: string,    // e.g. "adxl355_init", "ad7124_setup"
	$remove_function: string,  // e.g. "adxl355_remove"
	$descriptor: string,       // e.g. "adxl355_dev", "no_os_eeprom_desc"
	$header: string,           // Full path, e.g. "drivers/accel/adxl355/adxl355.h"
	$init_by_pointer: boolean, // true: init(&param), false: init(param)
};

export type RulesetPlatformOps = RulesetBase & {
	// FIXME: Rename this type
	_t: "RulesetPlatformOps",
	$type: RulesetType.RT_PLATFORM_OPS,
	$capability?: string,
};

export type Ruleset = RulesetStruct | RulesetEnum | RulesetPlatformOps | RulesetDevice;
