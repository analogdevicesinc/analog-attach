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
	// A field something other than the user fills in: it can be referenced but never set,
	// and is never emitted in an initializer. Two cases, both parsed by `parse_members`:
	// a descriptor member an init function writes, and a struct field the target template
	// derives (an iio_app_init_param device list, whose value is a local in main).
	readonly?: boolean,
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

// Exactly one of `include` / `include_type` is set; the parser rejects both and neither.
//
//   include:      "no-os/spi/no_os_spi_init_param.yaml"  -> match the one ruleset with that $id
//   include_type: descriptor                             -> match any ruleset of that type
//
// `include_type` exists for C's polymorphic fields: `iio_app_device.dev` is a `void *`
// that takes whichever driver descriptor the user picked, so no single $id describes it.
// It narrows what we suggest, it does not pin down a type — every descriptor matches.
export type IncludeMatch =
	| { include: string, include_type?: undefined }
	| { include?: undefined, include_type: RulesetType };

// `count` names the sibling field holding how many elements this pointer points at. C has
// no fat pointers, so a list is always a pair of fields (`devices` / `nb_devices`,
// `ctx_attrs` / `nb_ctx_attr`), and only the schema knows which number goes with which
// pointer. Declaring the pair means a consumer that found the pointer — by type, say —
// finds its length without guessing at a naming convention.
export type IncludeProperty = PropertyBase & {
	_t: "IncludeProperty",
	pointer?: boolean,
	count?: string,
} & IncludeMatch;

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
	| { _t: "PredicateNoneOf", reference: OverrideReference, values: unknown[] }
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
	RT_EXTERN = "bt_extern",
};

// The YAML spelling of a ruleset type. One vocabulary, used by both `$type:` on a
// ruleset and `include_type:` on a property, so the two can never drift apart.
export function ruleset_type_from_token(token: string): RulesetType | undefined {
	switch (token) {
		case "struct": { return RulesetType.RT_STRUCT; }
		case "enum": { return RulesetType.RT_ENUM; }
		case "platform_ops": { return RulesetType.RT_PLATFORM_OPS; }
		case "descriptor": { return RulesetType.RT_DESCRIPTOR; }
		case "extern": { return RulesetType.RT_EXTERN; }
		default: { return undefined; }
	}
}

// Inverse of the above, for error messages: report the spelling the author wrote.
export function ruleset_type_token(type_: RulesetType): string {
	switch (type_) {
		case RulesetType.RT_STRUCT: { return "struct"; }
		case RulesetType.RT_ENUM: { return "enum"; }
		case RulesetType.RT_PLATFORM_OPS: { return "platform_ops"; }
		case RulesetType.RT_DESCRIPTOR: { return "descriptor"; }
		case RulesetType.RT_EXTERN: { return "extern"; }
	}
}

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
	// Kconfig symbols this ruleset owns, without the CONFIG_ prefix (e.g. ["ACCEL",
	// "ACCEL_ADXL355"]). These become CONFIG_<sym>=y lines in the generated project
	// defconfig. Only symbols the ruleset owns are listed: a Kconfig `select` closes
	// the rest, but `depends on` is a constraint that is never auto-satisfied, so a
	// parent menu symbol has to be named alongside its leaf.
	$config?: string[],
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
	// `$init_param` is always first, so `properties[0]` keeps naming it. The rest are the
	// descriptor's own members, declared so the struct is described 1:1 and so they can be
	// referenced; a descriptor emits no initializer, so none of them are ever printed.
	properties: [IncludeProperty, ...Property[]]
};

export type RulesetPlatformOps = RulesetBase & {
	_t: "RulesetPlatformOps",
	$type: RulesetType.RT_PLATFORM_OPS,
	$capability?: string,
};

// A symbol the library already defines, so we reference it and never emit it:
//
//   extern struct iio_device iio_ad7124_device;   /* drivers/adc/ad7124/iio_ad7124.h */
//
// Modelling that as a struct would emit a second definition and fail to link. An extern
// has no properties — there is nothing to configure — so it makes no graph edges and its
// placement in the emission order is free. `$header` is what makes the declaration
// visible; `$config` is what gets the defining .c file compiled.
export type RulesetExtern = RulesetBase & {
	_t: "RulesetExtern",
	$type: RulesetType.RT_EXTERN,
	// The $id an `include` must name to accept this node, i.e. the C type of the global.
	// Externs are the one kind whose matching type is not their own $id: the $id names
	// this schema file, `$provides` names the type the symbol has.
	$provides: string,
	$header?: string,
	// The symbol is an array (`extern struct ad7124_st_reg ad7124_regs[AD7124_REG_NO];`).
	// An array name already decays to a pointer, so a `pointer: true` consumer must NOT
	// take its address: `&ad7124_regs` has type `struct ad7124_st_reg (*)[57]`, not
	// `struct ad7124_st_reg *`. Without this key the emitted `&` is a type error.
	$array?: boolean,
};

export type Ruleset = RulesetStruct | RulesetEnum | RulesetPlatformOps | RulesetDescriptor | RulesetExtern;

// The $id a node offers for `include` matching. Every kind answers with its own $id
// except an extern, which answers with the type of the symbol it names.
export function provided_id(ruleset: Ruleset): string {
	return ruleset._t === "RulesetExtern" ? ruleset.$provides : ruleset.$id;
}
