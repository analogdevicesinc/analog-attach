import type {
	PrimitiveCType,
	PrimitiveFloatCType,
	PrimitiveIntegerCType
} from "./primitive_c_types";

export interface PropertyBase {
	name: string,
	description: string,
	required?: boolean
	disabled?: boolean, // NOTE: default is disabled: false
	value?: unknown,
	capability?: string[], // Platform capabilities required for this property
}

export type PrimitiveSymbol = PrimitiveCType["symbol"];
export type PrimitiveIntegerSymbol = PrimitiveIntegerCType["symbol"];
export type PrimitiveFloatSymbol = PrimitiveFloatCType["symbol"];

export const PRIMITIVE_INTEGER_SYMBOLS: PrimitiveIntegerSymbol[] = [
	"uint8_t", "uint16_t", "uint32_t", "uint64_t",
	"int8_t", "int16_t", "int32_t", "int64_t",
	"size_t"
];

export const PRIMITIVE_FLOAT_SYMBOLS: PrimitiveFloatSymbol[] = [
	"float", "double"
];

export const PRIMITIVE_SYMBOLS: PrimitiveSymbol[] = [
	...PRIMITIVE_INTEGER_SYMBOLS,
	...PRIMITIVE_FLOAT_SYMBOLS
];

// TODO : Rename this, bool is separate primitive
export function is_primitive_symbols(s: string): s is PrimitiveSymbol {
	return (PRIMITIVE_SYMBOLS as readonly string[]).includes(s);
}

export function is_integer_symbol(s: string): s is PrimitiveIntegerSymbol {
	return (PRIMITIVE_INTEGER_SYMBOLS as readonly string[]).includes(s);
}

// `float`/`double` accept fractional values and are emitted with a decimal point
// (and an `f` suffix for `float`) so C does not read the token as an int.
export function is_float_symbol(s: string): s is PrimitiveFloatSymbol {
	return (PRIMITIVE_FLOAT_SYMBOLS as readonly string[]).includes(s);
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
    allowed?: string[], // NOTE: Set by override only
}

export type PlatformExtraProperty = PropertyBase & {
    _t: "PlatformExtraProperty",
    type: "platform_extra",
    allowed?: string[], // NOTE: Set by override only
}

// An opaque value emitted to codegen byte-for-byte, with no interpretation.
// Used for things we can't reason about: callback function pointers, external
// SDK handles, arbitrary expressions. The author writes the exact C token
// (including any `"`, `&`, etc.); it is stored and emitted verbatim. If a raw
// value is required but unset the validator warns only — we can't help, but the
// driver may need it (the user can fill it in before/after codegen).
export type RawProperty = PropertyBase & {
    _t: "RawProperty",
    type: "raw",
    default?: string,
}

export type ArrayElement = NumberProperty | BooleanProperty | EnumProperty | IncludeProperty;

export type ArrayProperty = PropertyBase & {
	_t: "ArrayProperty",
	size: number,
	element: ArrayElement,
}

export type Property = NumberProperty | BooleanProperty | StringProperty | IncludeProperty | EnumProperty | UnionProperty | ArrayProperty | PlatformOpsProperty | PlatformExtraProperty | RawProperty;

// The authoring-surface scope tokens. The parser strips these into concrete
// self/parent OverrideReference nodes during lowering.
export type OverrideScope = "$parent" | "$this";

// NOTE: Internal, new override resolution types
export interface OverrideReference {
	node: "self" | "parent",
	property: string
};

export type OverridePredicate =
	| { _t: "PredicateAlways" }
	| { _t: "PredicateEquals", reference: OverrideReference, value: unknown }
	| { _t: "PredicateHasValue", reference: OverrideReference }
	| { _t: "PredicateAnd", predicates: OverridePredicate[] };

export type Effect =
      // merge effects
      | { op: "setDefault",     reference: OverrideReference, value: unknown }
      | { op: "setMin",         reference: OverrideReference, value: number }
      | { op: "setMax",         reference: OverrideReference, value: number }
      | { op: "setValue",       reference: OverrideReference, value: unknown }   // number/scalar only (C1)
      | { op: "setRequired",    reference: OverrideReference, value: boolean }
      | { op: "setDescription", reference: OverrideReference, value: string }
      | { op: "setPointer",     reference: OverrideReference, value: boolean }
      | { op: "setDisabled",    reference: OverrideReference, value: boolean, reason?: string }  // reason drives mutex errors (D2)
      // validate effects
      | { op: "restrictValues", reference: OverrideReference, values: EnumValue[] }  // enum
      | { op: "selectMember",   reference: OverrideReference, member: string }       // union (validate, don't mutate)
      | { op: "restrictAllowed", reference: OverrideReference, ids: string[] };      // include/descriptor/platform_ops/extra

export interface Rule {
	when: OverridePredicate,
	effects: Effect[],
};

// TODO : Rename these bt_struct -> rt_struct
export enum RulesetType {
	RT_STRUCT = "bt_struct",
	RT_ENUM = "bt_enum",
	RT_PLATFORM_OPS = "bt_platform_ops",
	RT_DESCRIPTOR = "bt_descriptor",
};

enum RulesetRank {
	RR_PRODUCTION = 0, // Deployed in shipping products/apps, hardware validated across all variants
	RR_VALIDATED = 1, // Developer reviewed, tested on real hardware
	RR_REVIEWED = 2, // Human reviewed, schema validates, basic tests
	RR_GENERATED = 3, // Auto/AI generated, validates, but minimally tested
	RR_DRAFT = 4, // Experimental, may not fully validate
};

export interface RulesetHeaderSources {
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

export interface RulesetEnumValue {
	name: string | number,
	description?: string,
};

interface RulesetBase {
	_t: string,
	$id: string,
	$type: RulesetType,
	$symbol: string,
	$description: string,
	$ranking: RulesetRank,
	$sources: RulesetSources,
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
	rules?: Rule[],
	$requires?: string[], // Auto-computed: all capabilities required by properties
	$capability?: string,
	$header?: string,      // Device header path, e.g. "drivers/accel/adxl355/adxl355.h"
	$exposes?: string[],   // List of ops ids that this struct might expose
};

export type RulesetDescriptor = RulesetBase & {
	_t: "RulesetDescriptor",
	$type: RulesetType.RT_DESCRIPTOR,
	$init_template: string,
	$remove_template: string,
	properties: [IncludeProperty]
};

export type RulesetPlatformOps = RulesetBase & {
	_t: "RulesetPlatformOps",
	$type: RulesetType.RT_PLATFORM_OPS,
	$capability?: string,
};

export type Ruleset = RulesetStruct | RulesetEnum | RulesetPlatformOps | RulesetDescriptor;
