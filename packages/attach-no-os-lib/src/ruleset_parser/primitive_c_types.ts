// Auto-generated from primitive_types.yaml

interface primitive_uint8_t {
	_t: "primitive_uint8_t";
	symbol: "uint8_t";
	minimum: 0;
	maximum: 255;
};

interface primitive_uint16_t {
	_t: "primitive_uint16_t";
	symbol: "uint16_t";
	minimum: 0;
	maximum: 65_535;
};

interface primitive_uint32_t {
	_t: "primitive_uint32_t";
	symbol: "uint32_t";
	minimum: 0;
	maximum: 4_294_967_295;
};

interface primitive_uint64_t {
	_t: "primitive_uint64_t";
	symbol: "uint64_t";
	minimum: 0n;
	maximum: 18_446_744_073_709_551_615n;
};

interface primitive_int8_t {
	_t: "primitive_int8_t";
	symbol: "int8_t";
	minimum: -128;
	maximum: 127;
};

interface primitive_int16_t {
	_t: "primitive_int16_t";
	symbol: "int16_t";
	minimum: -32_768;
	maximum: 32_767;
};

interface primitive_int32_t {
	_t: "primitive_int32_t";
	symbol: "int32_t";
	minimum: -2_147_483_648;
	maximum: 2_147_483_647;
};

interface primitive_int64_t {
	_t: "primitive_int64_t";
	symbol: "int64_t";
	minimum: -9_223_372_036_854_775_808n;
	maximum: 9_223_372_036_854_775_807n;
};

interface primitive_size_t {
	_t: "primitive_size_t";
	symbol: "size_t";
	minimum: 0;
	maximum: undefined;
};

export type PrimitiveCType =
	| primitive_uint8_t
	| primitive_uint16_t
	| primitive_uint32_t
	| primitive_uint64_t
	| primitive_int8_t
	| primitive_int16_t
	| primitive_int32_t
	| primitive_int64_t
	| primitive_size_t;

