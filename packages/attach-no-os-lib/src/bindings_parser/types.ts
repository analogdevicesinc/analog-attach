import {
	PrimitiveCType
} from "./primitive_c_types";

export type PropertyBase = {
	name: string,
	description: string,
	required?: boolean
	disabled?: boolean, // NOTE: default is disabled: false
	value?: any,
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

export type IncludeProperty = PropertyBase & {
	_t: "IncludeProperty",
	include: string,
	pointer?: boolean,
}

export type EnumProperty = PropertyBase & {
	_t: "EnumProperty",
	values: string[],
	default?: string,
}

export type UnionProperty = PropertyBase & {
	_t: "UnionProperty",
	members: IncludeProperty[]
}

export type ArrayElement = NumberProperty | BooleanProperty | EnumProperty | IncludeProperty;

export type ArrayProperty = PropertyBase & {
	_t: "ArrayProperty",
	size: number,
	element: ArrayElement,
}

export type Property = NumberProperty | BooleanProperty | IncludeProperty | EnumProperty | UnionProperty | ArrayProperty;

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

type OverrideSwitch = {
	_t: "OverrideSwitch",
	scope: OverrideScope,
	$on: string,
	$cases: SwitchCase[],
}

type OverrideCondition = {
	target: string,
	value: unknown // FIXME: Does this need to be unknwon?
}

type OverrideIfThen = {
	_t: "OverrideIfThen",
	scope: OverrideScope,
	condition: OverrideCondition,
	overrides: TargetOverride[],
}

type OverrideMutex = {
	_t: "OverrideMutex",
	scope: OverrideScope,
	properties: string[]
}

type OverrideStatic = {
	_t: "OverrideStatic",
	scope: OverrideScope,
	target: string,
	override: PropertyOverride
}

export type PropertyOverride<T extends Property = Property> = Partial<Omit<T, '_t' | 'type' | 'name'>>;

export type OverrideScope = "$parent" | "$this";

export type OverrideDirective = OverrideSwitch | OverrideIfThen | OverrideStatic | OverrideMutex;

// TODO: Figure out how to specify the spi/i2c etc types, these are too generic
export enum BindingType {
	BT_STRUCT = "bt_struct",
	BT_ENUM = "bt_enum",
	BT_PLATFORM_OPS = "bt_platform_ops"
};

enum BindingRank {
	BR_PRODUCTION = 0, // Deployed in shipping products/apps, hardware validated across all variants
	BR_VALIDATED = 1, // Developer reviewd, tested on real hardware
	BR_REVIEWED = 2, // Human reviewed, schema validates, basic tests
	BR_GENERATED = 3, // Auto/AI generated, validates, but minimally tested
	BR_DRAFT = 4, // Experimental, may not fully validate
}

export type BindingHeaderSources = {
	headers: string[],
	sources?: string[],
}

export type BindingSources = BindingHeaderSources & {
	platform?: BindingHeaderSources,
	sdk?: BindingHeaderSources,
	$note?: string
}

export type Binding = {
	_t: "Binding",
	$id: string,
	$type: BindingType,
	$name: string,
	$description: string,
	$ranking: BindingRank,
	// TODO: add something like maintainer or edited_by?
	$sources: BindingSources,
	properties: Property[],
	$override?: OverrideDirective[],
};
