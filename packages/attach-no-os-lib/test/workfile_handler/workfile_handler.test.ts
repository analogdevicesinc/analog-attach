import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
    create_workfile,
    add_platform_ops,
    get_platform_ops,
    list_platform_ops,
    clear_platform_ops,
    add_symbol,
    get_symbol,
    remove_symbol,
    list_symbols,
    find_any,
    set_value,
    get_value,
    suggest_for_include,
    suggest_for_union,
    suggest_for_array,
    suggest_platform_ops,
    suggest_platform_extra,
    suggest_for_property,
    list_available_structs,
    load_platform,
    export_minimal,
    import_minimal,
    clone_workfile
} from '../../src/workfile_handler/workfile_handler';
import { Workfile } from '../../src/workfile_handler/types';
import {
    RulesetStruct,
    RulesetType,
    IncludeProperty,
    UnionProperty,
    ArrayProperty,
    RulesetPlatformOps,
    EnumProperty,
    BooleanProperty,
    PlatformOpsProperty,
    PlatformExtraProperty
} from '../../src/ruleset_parser/types';
import { scan_platform } from '../../src/workfile_handler/platform_scanner';
import { expectOk, expectError, expectErrorContains, setup_test_config, teardown_test_config, setup_no_config, teardown_no_config } from '../test_utilities';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import minimal_workfile_spi from './fixtures/minimal_workfile_spi.json';

function make_struct(id: string, name: string, properties: RulesetStruct['properties'] = []): RulesetStruct {
    return {
        _t: "RulesetStruct",
        $id: id,
        $type: RulesetType.RT_STRUCT,
        $symbol: name,
        $description: "Test struct",
        $ranking: 4,
        $sources: { headers: ["test.h"] },
        properties,
    };
}

function make_platform_ops(id: string, name: string, capability?: string): RulesetPlatformOps {
    return {
        _t: "RulesetPlatformOps",
        $id: id,
        $type: RulesetType.RT_PLATFORM_OPS,
        $symbol: name,
        $description: "Test ops",
        $ranking: 4,
        $sources: { headers: ["test.h"] },
        $capability: capability,
    };
}

function make_include(name: string, include: string, value?: string): IncludeProperty {
    return {
        _t: "IncludeProperty",
        name,
        description: "",
        include,
        value,
    };
}

function make_union(name: string, members: IncludeProperty[], value?: Record<string, string>): UnionProperty {
    return {
        _t: "UnionProperty",
        name,
        description: "",
        members,
        value,
    };
}

function make_array(name: string, size: number, element: ArrayProperty['element'], value?: string[]): ArrayProperty {
    return {
        _t: "ArrayProperty",
        name,
        description: "",
        size,
        element,
        value,
    };
}

const NOOS_ROOT = path.join(__dirname, '../bindings');
const SCHEMAS_ROOT = path.join(NOOS_ROOT, 'schemas');

describe('workfile_handler', () => {
    let workfile: Workfile;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        const result = create_workfile();
        expectOk(result);
        workfile = result.value;
    });

    afterEach(() => {
        teardown_test_config();
    });

    describe('Symbol CRUD', () => {
        test('add_symbol adds a new symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            const result = add_symbol(workfile, "my_foo", ruleset);
            expectOk(result);
            expect(list_symbols(workfile)).toContain("my_foo");
        });

        test('add_symbol rejects duplicate names', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            add_symbol(workfile, "my_foo", ruleset);
            const result = add_symbol(workfile, "my_foo", ruleset);
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('get_symbol returns existing symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            add_symbol(workfile, "my_foo", ruleset);
            const result = get_symbol(workfile, "my_foo");
            expectOk(result);
            expect(result.value.$id).toBe("test/foo.yaml");
        });

        test('get_symbol returns error for unknown symbol', () => {
            const result = get_symbol(workfile, "unknown");
            expectError(result);
            expectErrorContains(result, "does not exist");
        });

        test('remove_symbol removes existing symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            add_symbol(workfile, "my_foo", ruleset);
            const result = remove_symbol(workfile, "my_foo");
            expectOk(result);
            expect(list_symbols(workfile)).not.toContain("my_foo");
        });

        test('remove_symbol returns error for unknown symbol', () => {
            const result = remove_symbol(workfile, "unknown");
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('list_symbols returns all symbol names', () => {
            add_symbol(workfile, "foo", make_struct("a.yaml", "a"));
            add_symbol(workfile, "bar", make_struct("b.yaml", "b"));
            add_symbol(workfile, "baz", make_struct("c.yaml", "c"));
            expect(list_symbols(workfile)).toEqual(["foo", "bar", "baz"]);
        });

        test('add_symbol rejects name that conflicts with platform_ops', () => {
            add_platform_ops(workfile, "spi_ops", make_platform_ops("ops/spi.yaml", "spi_ops", "spi"));
            const result = add_symbol(workfile, "spi_ops", make_struct("test.yaml", "test"));
            expectError(result);
            expectErrorContains(result, "conflicts with platform ops");
        });
    });

    describe('Platform Ops', () => {
        test('add_platform_ops adds ops', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            const result = add_platform_ops(workfile, "spi_ops", ops);
            expectOk(result);
            expect(list_platform_ops(workfile)).toContain("spi_ops");
        });

        test('add_platform_ops rejects duplicate names', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            add_platform_ops(workfile, "spi_ops", ops);
            const result = add_platform_ops(workfile, "spi_ops", ops);
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('get_platform_ops returns existing ops', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            add_platform_ops(workfile, "spi_ops", ops);
            const result = get_platform_ops(workfile, "spi_ops");
            expectOk(result);
            expect(result.value.$id).toBe("ops/spi.yaml");
            expect(result.value.$capability).toBe("spi");
        });

        test('get_platform_ops returns error for unknown ops', () => {
            const result = get_platform_ops(workfile, "unknown");
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('clear_platform_ops removes all ops', () => {
            add_platform_ops(workfile, "spi_ops", make_platform_ops("spi.yaml", "spi_ops", "spi"));
            add_platform_ops(workfile, "i2c_ops", make_platform_ops("i2c.yaml", "i2c_ops", "i2c"));
            clear_platform_ops(workfile);
            expect(list_platform_ops(workfile)).toEqual([]);
        });

        test('find_any finds platform_ops', () => {
            add_platform_ops(workfile, "spi_ops", make_platform_ops("spi.yaml", "spi_ops", "spi"));
            const result = find_any(workfile, "spi_ops");
            expect(result).toBeDefined();
            expect(result?.$id).toBe("spi.yaml");
        });

        test('find_any finds symbols', () => {
            add_symbol(workfile, "my_struct", make_struct("test.yaml", "test"));
            const result = find_any(workfile, "my_struct");
            expect(result).toBeDefined();
            expect(result?.$id).toBe("test.yaml");
        });

        test('find_any returns undefined for unknown', () => {
            const result = find_any(workfile, "unknown");
            expect(result).toBeUndefined();
        });
    });

    describe('Property Values', () => {
        test('set_value sets property value', () => {
            const ruleset = make_struct("test/foo.yaml", "foo", [
                { _t: "NumberProperty", name: "count", description: "", type: "uint32_t" }
            ]);
            add_symbol(workfile, "my_foo", ruleset);
            const result = set_value(workfile, "my_foo", "count", 42);
            expectOk(result);
            const get_result = get_value(workfile, "my_foo", "count");
            expectOk(get_result);
            expect(get_result.value).toBe(42);
        });

        test('set_value returns error for unknown symbol', () => {
            const result = set_value(workfile, "unknown", "count", 42);
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('set_value returns error for unknown property', () => {
            const ruleset = make_struct("test/foo.yaml", "foo", []);
            add_symbol(workfile, "my_foo", ruleset);
            const result = set_value(workfile, "my_foo", "unknown", 42);
            expectError(result);
            expectErrorContains(result, "not found");
        });
    });

    describe('suggest_for_include', () => {
        test('returns matching symbols', () => {
            add_symbol(workfile, "spi1", make_struct("no-os/spi.yaml", "spi"));
            add_symbol(workfile, "spi2", make_struct("no-os/spi.yaml", "spi"));
            add_symbol(workfile, "i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const include = make_include("spi", "no-os/spi.yaml");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toEqual(["spi1", "spi2"]);
            expect(suggestions.value.types).toEqual(["no-os/spi.yaml"]);
        });

        test('returns empty values when no matches', () => {
            add_symbol(workfile, "i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const include = make_include("spi", "no-os/spi.yaml");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toBeUndefined();
            expect(suggestions.value.types).toEqual(["no-os/spi.yaml"]);
        });

        test('returns enum values when include points to enum', () => {
            const include = make_include("channel_mode", "devices/ad5592r/enums/ad5592r_channel_mode.yaml");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toContain("CH_MODE_UNUSED");
            expect(suggestions.value.values).toContain("CH_MODE_ADC");
            expect(suggestions.value.values).toContain("CH_MODE_DAC");
            expect(suggestions.value.types).toBeUndefined();
        });
    });

    describe('suggest_for_union', () => {
        test('returns matching symbols for member', () => {
            add_symbol(workfile, "spi1", make_struct("no-os/spi.yaml", "spi"));
            add_symbol(workfile, "i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const union = make_union("comm", [
                make_include("spi", "no-os/spi.yaml"),
                make_include("i2c", "no-os/i2c.yaml"),
            ]);
            const result = suggest_for_union(workfile, union, "spi");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1"]);
            expect(result.value.types).toEqual(["no-os/spi.yaml"]);
        });

        test('returns error for unknown member', () => {
            const union = make_union("comm", [
                make_include("spi", "no-os/spi.yaml"),
            ]);
            const result = suggest_for_union(workfile, union, "uart");
            expectError(result);
            expectErrorContains(result, "Unknown union member");
        });
    });

    describe('suggest_for_array', () => {
        test('returns matching symbols for array element', () => {
            add_symbol(workfile, "gpio1", make_struct("no-os/gpio.yaml", "gpio"));
            add_symbol(workfile, "gpio2", make_struct("no-os/gpio.yaml", "gpio"));

            const array = make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"));
            const result = suggest_for_array(workfile, array);
            expectOk(result);
            expect(result.value.values).toEqual(["gpio1", "gpio2"]);
            expect(result.value.types).toEqual(["no-os/gpio.yaml"]);
        });

        test('returns empty object for number element', () => {
            const array: ArrayProperty = {
                _t: "ArrayProperty",
                name: "values",
                description: "",
                size: 2,
                element: { _t: "NumberProperty", name: "element", description: "", type: "uint32_t" }
            };
            const result = suggest_for_array(workfile, array);
            expectOk(result);
            expect(result.value).toEqual({});
        });
    });

    describe('Persistence', () => {
        test('clone_workfile returns a copy', () => {
            add_symbol(workfile, "foo", make_struct("foo.yaml", "foo"));
            const cloned = clone_workfile(workfile);
            expect(cloned.symbols["foo"].$id).toBe("foo.yaml");

            cloned.symbols["foo"].$id = "changed.yaml";
            expect(workfile.symbols["foo"].$id).toBe("foo.yaml");
        });
    });

    describe('load_platform', () => {
        const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');

        test('loads max32690 platform ops from real files', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            const result = load_platform(workfile, scan_result.value);
            expectOk(result);

            const ops_list = list_platform_ops(workfile);
            expect(ops_list).toHaveLength(7);
            expect(ops_list).toContain('max_spi_ops');
            expect(ops_list).toContain('max_i2c_ops');
            expect(ops_list).toContain('max_gpio_ops');
        });

        test('clears existing ops before loading', () => {
            add_platform_ops(workfile, 'old_ops', make_platform_ops('old.yaml', 'old_ops', 'old'));

            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            load_platform(workfile, scan_result.value);

            expect(list_platform_ops(workfile)).not.toContain('old_ops');
            expect(list_platform_ops(workfile)).toContain('max_spi_ops');
        });

        test('loaded ops can be found with find_any', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            load_platform(workfile, scan_result.value);

            const spi_ops = find_any(workfile, 'max_spi_ops');
            expect(spi_ops).toBeDefined();
            expect(spi_ops?._t).toBe('RulesetPlatformOps');
        });

        test('returns error if binding is not platform_ops', () => {
            const manifest = { name: 'max32690', vendor: 'maxim', ops: ['platforms/maxim/max32690/max_spi_init_param.yaml'], structs: [] };

            const result = load_platform(workfile, manifest);
            expectError(result);
            expectErrorContains(result, 'Expected platform_ops');
        });
    });

    describe('suggest_for_property', () => {
        test('suggests enum values', () => {
            const struct = make_struct("test.yaml", "test", [
                { _t: "EnumProperty", name: "mode", description: "", values: ["MODE_A", "MODE_B", "MODE_C"] } as EnumProperty
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "mode");
            expectOk(result);
            expect(result.value).toEqual({ values: ["MODE_A", "MODE_B", "MODE_C"] });
        });

        test('suggests boolean values', () => {
            const struct = make_struct("test.yaml", "test", [
                { _t: "BooleanProperty", name: "enabled", description: "", type: "bool", default: false } as BooleanProperty
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "enabled");
            expectOk(result);
            expect(result.value).toEqual({ values: ["true", "false"] });
        });

        test('suggests matching symbols for include property', () => {
            add_symbol(workfile, "spi1", make_struct("no-os/spi.yaml", "spi"));
            add_symbol(workfile, "spi2", make_struct("no-os/spi.yaml", "spi"));

            const struct = make_struct("test.yaml", "test", [
                make_include("spi_ref", "no-os/spi.yaml")
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "spi_ref");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1", "spi2"]);
            expect(result.value.types).toEqual(["no-os/spi.yaml"]);
        });

        test('suggests union member names when no member specified', () => {
            const struct = make_struct("test.yaml", "test", [
                make_union("comm", [
                    make_include("spi_init", "no-os/spi.yaml"),
                    make_include("i2c_init", "no-os/i2c.yaml"),
                ])
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "comm");
            expectOk(result);
            expect(result.value).toEqual({ values: ["spi_init", "i2c_init"] });
        });

        test('suggests symbols for union member when member specified', () => {
            add_symbol(workfile, "spi1", make_struct("no-os/spi.yaml", "spi"));

            const struct = make_struct("test.yaml", "test", [
                make_union("comm", [
                    make_include("spi_init", "no-os/spi.yaml"),
                    make_include("i2c_init", "no-os/i2c.yaml"),
                ])
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "comm", "spi_init");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1"]);
            expect(result.value.types).toEqual(["no-os/spi.yaml"]);
        });

        test('returns empty object for number property', () => {
            const struct = make_struct("test.yaml", "test", [
                { _t: "NumberProperty", name: "count", description: "", type: "uint32_t" }
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "count");
            expectOk(result);
            expect(result.value).toEqual({});
        });

        test('returns error for unknown symbol', () => {
            const result = suggest_for_property(workfile, "unknown", "prop");
            expectError(result);
        });

        test('returns error for unknown property', () => {
            add_symbol(workfile, "my_struct", make_struct("test.yaml", "test", []));
            const result = suggest_for_property(workfile, "my_struct", "unknown");
            expectError(result);
        });
    });

    describe('suggest_platform_ops', () => {
        const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');

        test('suggests ops matching capability', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            const spi_struct: RulesetStruct = {
                ...make_struct("no-os/spi.yaml", "spi"),
                $capability: "spi"
            };

            const property: PlatformOpsProperty = {
                _t: "PlatformOpsProperty",
                name: "platform_ops",
                description: "",
                type: "platform_ops",
                target: "no_os_spi_ops"
            };

            const result = suggest_platform_ops(workfile, property, spi_struct);
            expectOk(result);
            expect(result.value.values).toContain("max_spi_ops");
            expect(result.value.values).not.toContain("max_i2c_ops");
        });

        test('suggests ops from allowed list when override present', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            const spi_struct: RulesetStruct = {
                ...make_struct("no-os/spi.yaml", "spi"),
                $capability: "spi"
            };

            const property: PlatformOpsProperty = {
                _t: "PlatformOpsProperty",
                name: "platform_ops",
                description: "",
                type: "platform_ops",
                target: "no_os_spi_ops",
                allowed: ["platforms/maxim/max32690/platform_ops/spi_ops.yaml"]
            };

            const result = suggest_platform_ops(workfile, property, spi_struct);
            expectOk(result);
            expect(result.value).toEqual({ values: ["max_spi_ops"] });
        });
    });

    describe('suggest_platform_extra', () => {
        const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');

        test('suggests extras matching capability', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            // Create symbols that match platform structs
            const spi_extra: RulesetStruct = {
                ...make_struct("platforms/maxim/max32690/max_spi_init_param.yaml", "max_spi_init_param"),
                $capability: "spi"
            };
            const i2c_extra: RulesetStruct = {
                ...make_struct("platforms/maxim/max32690/max_i2c_init_param.yaml", "max_i2c_init_param"),
                $capability: "i2c"
            };
            add_symbol(workfile, "my_spi_extra", spi_extra);
            add_symbol(workfile, "my_i2c_extra", i2c_extra);

            const parent: RulesetStruct = {
                ...make_struct("no-os/spi.yaml", "spi"),
                $capability: "spi"
            };

            const property: PlatformExtraProperty = {
                _t: "PlatformExtraProperty",
                name: "extra",
                description: "",
                type: "platform_extra"
            };

            const result = suggest_platform_extra(workfile, property, parent);
            expectOk(result);
            expect(result.value.values).toContain("my_spi_extra");
            expect(result.value.values).not.toContain("my_i2c_extra");
        });
    });

    describe('list_available_structs', () => {
        test('returns device, noos, and platform structs', () => {
            const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            const result = list_available_structs(workfile);
            expectOk(result);

            expect(result.value.devices.length).toBeGreaterThan(0);
            expect(result.value.devices.some((d: string) => d.includes("adxl355"))).toBe(true);

            expect(result.value.noos.length).toBeGreaterThan(0);
            expect(result.value.noos.some((n: string) => n.includes("spi"))).toBe(true);

            expect(result.value.platform.length).toBe(5);
            expect(result.value.platform).toContain("platforms/maxim/max32690/max_spi_init_param.yaml");
        });

        test('returns error when schemas_path not set', () => {
            setup_no_config();
            const result = list_available_structs(workfile);
            teardown_no_config();
            expectError(result);
        });
    });

    describe('export_minimal', () => {
        const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');

        test('exports platform name and symbol values', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            const spi_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_result);
            add_symbol(workfile, "my_spi", spi_result.value);
            set_value(workfile, "my_spi", "device_id", 1);
            set_value(workfile, "my_spi", "chip_select", 2);

            const result = export_minimal(workfile);
            expectOk(result);

            expect(result.value.platform).toBe(minimal_workfile_spi.platform);
            expect(result.value.symbols["my_spi"].$compatible).toBe(minimal_workfile_spi.symbols.my_spi.$compatible);
            expect(result.value.symbols["my_spi"]["device_id"]).toBe(minimal_workfile_spi.symbols.my_spi.device_id);
            expect(result.value.symbols["my_spi"]["chip_select"]).toBe(minimal_workfile_spi.symbols.my_spi.chip_select);
        });

        test('returns error when no platform loaded', () => {
            const result = export_minimal(workfile);
            expectError(result);
            expectErrorContains(result, "No platform loaded");
        });
    });

    describe('import_minimal', () => {
        test('imports minimal workfile and restores full state', () => {
            const minimal = {
                platform: "max32690",
                symbols: {
                    "my_spi": {
                        $compatible: "no-os/no_os_spi_init_param.yaml",
                        device_id: 1,
                        chip_select: 2,
                    }
                }
            };

            const result = import_minimal(minimal);
            expectOk(result);

            const imported = result.value;
            expect(list_platform_ops(imported)).toContain("max_spi_ops");
            expect(list_symbols(imported)).toContain("my_spi");

            const device_id = get_value(imported, "my_spi", "device_id");
            expectOk(device_id);
            expect(device_id.value).toBe(1);
        });

        test('returns error for unknown platform', () => {
            const minimal = {
                platform: "unknown_platform",
                symbols: {}
            };

            const result = import_minimal(minimal);
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('round-trip: export then import produces same state', () => {
            const scan_result = scan_platform(path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690'));
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            const spi_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_result);
            add_symbol(workfile, "test_spi", spi_result.value);
            set_value(workfile, "test_spi", "device_id", 42);
            set_value(workfile, "test_spi", "chip_select", 3);

            const exported = export_minimal(workfile);
            expectOk(exported);

            const import_result = import_minimal(exported.value);
            expectOk(import_result);

            const workfile2 = import_result.value;
            expect(list_platform_ops(workfile2)).toContain("max_spi_ops");
            expect(list_symbols(workfile2)).toContain("test_spi");

            const device_id = get_value(workfile2, "test_spi", "device_id");
            expectOk(device_id);
            expect(device_id.value).toBe(42);
        });

        test('round-trip preserves array values', () => {
            const minimal = {
                platform: "max32690",
                symbols: {
                    "my_ad5592r": {
                        $compatible: "devices/ad5592r/ad5592r.yaml",
                        channel_modes: ["CH_MODE_ADC", "CH_MODE_DAC", "CH_MODE_UNUSED"]
                    }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_ad5592r"]["channel_modes"]).toEqual(["CH_MODE_ADC", "CH_MODE_DAC", "CH_MODE_UNUSED"]);
        });

        test('round-trip preserves union values', () => {
            const minimal = {
                platform: "max32690",
                symbols: {
                    "my_spi": {
                        $compatible: "no-os/no_os_spi_init_param.yaml",
                        device_id: 1
                    },
                    "my_adxl355": {
                        $compatible: "devices/adxl355/adxl355.yaml",
                        comm_type: "ADXL355_SPI_COMM",
                        dev_type: "ID_ADXL355",
                        comm_init: { spi_init: "my_spi" }
                    }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_adxl355"]["comm_init"]).toEqual({ spi_init: "my_spi" });
        });

        test('round-trip preserves boolean values', () => {
            const minimal = {
                platform: "max32690",
                symbols: {
                    "my_ad7124": {
                        $compatible: "devices/ad7124/ad7124.yaml",
                        ref_en: false,
                        check_ready: true
                    }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_ad7124"]["ref_en"]).toBe(false);
            expect(exported.value.symbols["my_ad7124"]["check_ready"]).toBe(true);
        });
    });

    describe('platform_vendor', () => {
        test('platform_vendor is set after loading platform', () => {
            const scan_result = scan_platform(path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690'));
            expectOk(scan_result);
            load_platform(workfile, scan_result.value);

            expect(workfile.platform_vendor).toBe("maxim");
        });

        test('create_workfile sets platform_vendor', () => {
            const result = create_workfile("max32690");
            expectOk(result);
            expect(result.value.platform_vendor).toBe("maxim");
        });

        test('import_minimal sets platform_vendor', () => {
            const minimal = {
                platform: "max32690",
                symbols: {}
            };

            const result = import_minimal(minimal);
            expectOk(result);
            expect(result.value.platform_vendor).toBe("maxim");
        });
    });
});
