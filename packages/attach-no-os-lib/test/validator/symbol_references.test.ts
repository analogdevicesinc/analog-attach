import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { get_symbol_references, get_connected_symbols } from '../../src/validator/connection_graph';
import { setup_test_config, teardown_test_config } from '../test_utilities';
import {
    ArrayProperty,
    BooleanProperty,
    EnumProperty,
    IncludeProperty,
    NumberProperty,
    PlatformExtraProperty,
    PlatformOpsProperty,
    RawProperty,
    UnionProperty
} from '../../src/ruleset_parser/types';

// `get_symbol_references` answers "which symbols does this property reference, and HOW":
// by value (the referenced struct is embedded, so it must be defined first) or by
// pointer (only an address is stored, so a declaration is enough). Codegen ordering
// relies on the distinction; the validator and override scoping still want every
// reference regardless of kind, which is what `get_connected_symbols` returns.
const NOOS_ROOT = path.join(__dirname, '../bindings');

function make_include(value?: string, pointer?: boolean): IncludeProperty {
    return {
        _t: "IncludeProperty",
        name: "test_prop",
        description: "",
        include: "no-os/spi/no_os_spi_init_param.yaml",
        ...(pointer === undefined ? {} : { pointer }),
        value,
    };
}

function make_array(element: ArrayProperty['element'], value?: unknown): ArrayProperty {
    return { _t: "ArrayProperty", name: "test_prop", description: "", size: 4, element, value };
}

function make_union(members: IncludeProperty[], value?: Record<string, string>): UnionProperty {
    return { _t: "UnionProperty", name: "test_prop", description: "", members, value };
}

describe('get_symbol_references', () => {
    // Array elements are resolved against the schemas repo to tell an enum-backed
    // include (values, not references) from a struct include.
    beforeEach(() => { setup_test_config(NOOS_ROOT); });
    afterEach(() => { teardown_test_config(); });

    describe('include', () => {
        test('an embedded include is a value reference', () => {
            expect(get_symbol_references(make_include("spi_ip"))).toEqual([
                { name: "spi_ip", kind: "value" }
            ]);
        });

        test('pointer: false is a value reference', () => {
            expect(get_symbol_references(make_include("spi_ip", false))).toEqual([
                { name: "spi_ip", kind: "value" }
            ]);
        });

        // The i3c device -> bus back-reference.
        test('pointer: true is a pointer reference', () => {
            expect(get_symbol_references(make_include("i3c1_ip", true))).toEqual([
                { name: "i3c1_ip", kind: "pointer" }
            ]);
        });

        // An unset include references nothing — a NULL pointer, not a dependency.
        test('an unset include references nothing', () => {
            expect(get_symbol_references(make_include(undefined, true))).toEqual([]);
        });
    });

    describe('array', () => {
        // i3c's `devs`: `const struct no_os_i3c_init_param **`, so every element is
        // an address and none of them constrains ordering.
        test('an array of pointer includes yields pointer references', () => {
            const property = make_array(
                { ...make_include(undefined, true), include: "no-os/i3c/no_os_i3c_init_param.yaml" },
                ["dev_a", "dev_b"]
            );
            expect(get_symbol_references(property)).toEqual([
                { name: "dev_a", kind: "pointer" },
                { name: "dev_b", kind: "pointer" }
            ]);
        });

        // ad7124's `setups`: a real C array of embedded structs, which genuinely
        // needs each element fully defined first.
        test('an array of embedded includes yields value references', () => {
            const property = make_array(
                { ...make_include(), include: "devices/ad7124/structs/ad7124_channel_setup.yaml" },
                ["setup_a", "setup_b"]
            );
            expect(get_symbol_references(property)).toEqual([
                { name: "setup_a", kind: "value" },
                { name: "setup_b", kind: "value" }
            ]);
        });

        // Enum-backed array entries are enum constants, not symbols.
        test('an array of enum includes references nothing', () => {
            const property = make_array(
                { ...make_include(), include: "devices/ad5592r/enums/ad5592r_channel_mode.yaml" },
                ["AD5592R_MODE_ADC", "AD5592R_MODE_DAC"]
            );
            expect(get_symbol_references(property)).toEqual([]);
        });

        test('a non-include array references nothing', () => {
            const element: NumberProperty = {
                _t: "NumberProperty", name: "e", description: "", type: "uint8_t"
            };
            expect(get_symbol_references(make_array(element, [1, 2]))).toEqual([]);
        });

        test('an unset array references nothing', () => {
            const property = make_array({ ...make_include(undefined, true) });
            expect(get_symbol_references(property)).toEqual([]);
        });
    });

    describe('union', () => {
        // No schema sets `pointer` on a union member today, so every union reference
        // is currently a value edge; the flag is read per member so that stays true
        // only as long as the schemas say so.
        test('a member without pointer is a value reference', () => {
            const property = make_union(
                [{ ...make_include(), name: "spi_init" }, { ...make_include(), name: "i2c_init" }],
                { spi_init: "spi_ip" }
            );
            expect(get_symbol_references(property)).toEqual([
                { name: "spi_ip", kind: "value" }
            ]);
        });

        test('a member declared pointer: true is a pointer reference', () => {
            const property = make_union(
                [{ ...make_include(undefined, true), name: "spi_init" }],
                { spi_init: "spi_ip" }
            );
            expect(get_symbol_references(property)).toEqual([
                { name: "spi_ip", kind: "pointer" }
            ]);
        });

        // The kind comes from the SELECTED member, not from whichever is declared first.
        test('the kind follows the selected member', () => {
            const property = make_union(
                [
                    { ...make_include(undefined, true), name: "spi_init" },
                    { ...make_include(), name: "i2c_init" }
                ],
                { i2c_init: "i2c_ip" }
            );
            expect(get_symbol_references(property)).toEqual([
                { name: "i2c_ip", kind: "value" }
            ]);
        });

        test('an unset union references nothing', () => {
            expect(get_symbol_references(make_union([{ ...make_include(), name: "spi_init" }]))).toEqual([]);
        });
    });

    // platform_extra is `void *extra` and emitted as `&extra`, so strictly a pointer,
    // but deliberately classified as a value edge: platform structs never reference
    // anything back (no cycle is possible) and relaxing them would reshuffle struct
    // order in every existing project for no benefit.
    describe('platform_extra', () => {
        test('is a value reference despite being emitted as an address', () => {
            const property: PlatformExtraProperty = {
                _t: "PlatformExtraProperty", name: "extra", description: "",
                type: "platform_extra", value: "stm32_i3c_ip"
            };
            expect(get_symbol_references(property)).toEqual([
                { name: "stm32_i3c_ip", kind: "value" }
            ]);
        });

        test('an unset platform_extra references nothing', () => {
            const property: PlatformExtraProperty = {
                _t: "PlatformExtraProperty", name: "extra", description: "", type: "platform_extra"
            };
            expect(get_symbol_references(property)).toEqual([]);
        });
    });

    // Shapes that hold no symbol reference at all. platform_ops names an ops table,
    // not a workfile symbol, and was never reported as a connection.
    describe('shapes with no symbol references', () => {
        test('platform_ops', () => {
            const property: PlatformOpsProperty = {
                _t: "PlatformOpsProperty", name: "platform_ops", description: "",
                type: "platform_ops", value: "stm32_i3c_ops"
            };
            expect(get_symbol_references(property)).toEqual([]);
        });

        test('number', () => {
            const property: NumberProperty = {
                _t: "NumberProperty", name: "n", description: "", type: "uint8_t", value: 1
            };
            expect(get_symbol_references(property)).toEqual([]);
        });

        test('boolean', () => {
            const property: BooleanProperty = {
                _t: "BooleanProperty", name: "b", description: "", type: "bool",
                default: false, value: true
            };
            expect(get_symbol_references(property)).toEqual([]);
        });

        test('enum', () => {
            const property: EnumProperty = {
                _t: "EnumProperty", name: "e", description: "",
                values: ["A", "B"], value: "A"
            };
            expect(get_symbol_references(property)).toEqual([]);
        });

        // A raw value can literally contain `&other_symbol`, but it is opaque by
        // design and emitted verbatim, so it is not tracked as a reference.
        test('raw', () => {
            const property: RawProperty = {
                _t: "RawProperty", name: "r", description: "", type: "raw", value: "&hi3c1"
            };
            expect(get_symbol_references(property)).toEqual([]);
        });
    });
});

// get_connected_symbols is now a projection of get_symbol_references. These lock in
// that it still reports EVERY reference, pointer ones included — the validator and
// override scoping depend on that, and losing pointer references there would silently
// stop `bus: i3c1_ip` from being checked or scoped.
describe('get_connected_symbols', () => {
    beforeEach(() => { setup_test_config(NOOS_ROOT); });
    afterEach(() => { teardown_test_config(); });

    test('reports pointer references as connections', () => {
        expect(get_connected_symbols(make_include("i3c1_ip", true))).toEqual(["i3c1_ip"]);
    });

    test('reports value references as connections', () => {
        expect(get_connected_symbols(make_include("spi_ip"))).toEqual(["spi_ip"]);
    });

    test('reports every element of an array of pointer includes', () => {
        const property = make_array(
            { ...make_include(undefined, true), include: "no-os/i3c/no_os_i3c_init_param.yaml" },
            ["dev_a", "dev_b"]
        );
        expect(get_connected_symbols(property)).toEqual(["dev_a", "dev_b"]);
    });

    test('drops the kind, keeping only names', () => {
        const property = make_union(
            [{ ...make_include(undefined, true), name: "spi_init" }],
            { spi_init: "spi_ip" }
        );
        expect(get_connected_symbols(property)).toEqual(["spi_ip"]);
    });
});
