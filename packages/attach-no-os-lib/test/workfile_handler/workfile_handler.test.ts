import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { WorkfileHandler } from '../../src/workfile_handler/workfile_handler';
import { RulesetStruct, RulesetType, IncludeProperty, UnionProperty, ArrayProperty, RulesetPlatformOps } from '../../src/bindings_parser/types';
import { scan_platform } from '../../src/context_handler/platform_scanner';
import { expectOk, expectError, expectErrorContains } from '../test_utils';
import { set_schemas_path, reset_settings } from '../../src/settings/settings';

function make_struct(id: string, name: string, properties: RulesetStruct['properties'] = []): RulesetStruct {
    return {
        _t: "BindingStuct",
        $id: id,
        $type: RulesetType.BT_STRUCT,
        $symbol: name,
        $description: "Test struct",
        $ranking: 4,
        $sources: { headers: ["test.h"] },
        properties,
    };
}

function make_platform_ops(id: string, name: string, capability?: string): RulesetPlatformOps {
    return {
        _t: "BindingPlatformOps",
        $id: id,
        $type: RulesetType.BT_PLATFORM_OPS,
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

const SCHEMAS_ROOT = path.join(__dirname, '../bindings/schemas');

describe('WorkfileHandler', () => {
    let handler: WorkfileHandler;

    beforeEach(() => {
        set_schemas_path(SCHEMAS_ROOT);
        handler = new WorkfileHandler();
    });

    afterEach(() => {
        reset_settings();
    });

    describe('Symbol CRUD', () => {
        test('add_symbol adds a new symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            const result = handler.add_symbol("my_foo", ruleset);
            expectOk(result);
            expect(handler.list_symbols()).toContain("my_foo");
        });

        test('add_symbol rejects duplicate names', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            handler.add_symbol("my_foo", ruleset);
            const result = handler.add_symbol("my_foo", ruleset);
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('get_symbol returns existing symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            handler.add_symbol("my_foo", ruleset);
            const result = handler.get_symbol("my_foo");
            expectOk(result);
            expect(result.value.$id).toBe("test/foo.yaml");
        });

        test('get_symbol returns error for unknown symbol', () => {
            const result = handler.get_symbol("unknown");
            expectError(result);
            expectErrorContains(result, "does not exist");
        });

        test('remove_symbol removes existing symbol', () => {
            const ruleset = make_struct("test/foo.yaml", "foo");
            handler.add_symbol("my_foo", ruleset);
            const result = handler.remove_symbol("my_foo");
            expectOk(result);
            expect(handler.list_symbols()).not.toContain("my_foo");
        });

        test('remove_symbol returns error for unknown symbol', () => {
            const result = handler.remove_symbol("unknown");
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('list_symbols returns all symbol names', () => {
            handler.add_symbol("foo", make_struct("a.yaml", "a"));
            handler.add_symbol("bar", make_struct("b.yaml", "b"));
            handler.add_symbol("baz", make_struct("c.yaml", "c"));
            expect(handler.list_symbols()).toEqual(["foo", "bar", "baz"]);
        });

        test('add_symbol rejects name that conflicts with platform_ops', () => {
            handler.add_platform_ops("spi_ops", make_platform_ops("ops/spi.yaml", "spi_ops", "spi"));
            const result = handler.add_symbol("spi_ops", make_struct("test.yaml", "test"));
            expectError(result);
            expectErrorContains(result, "conflicts with platform ops");
        });
    });

    describe('Platform Ops', () => {
        test('add_platform_ops adds ops', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            const result = handler.add_platform_ops("spi_ops", ops);
            expectOk(result);
            expect(handler.list_platform_ops()).toContain("spi_ops");
        });

        test('add_platform_ops rejects duplicate names', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            handler.add_platform_ops("spi_ops", ops);
            const result = handler.add_platform_ops("spi_ops", ops);
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('get_platform_ops returns existing ops', () => {
            const ops = make_platform_ops("ops/spi.yaml", "spi_ops", "spi");
            handler.add_platform_ops("spi_ops", ops);
            const result = handler.get_platform_ops("spi_ops");
            expectOk(result);
            expect(result.value.$id).toBe("ops/spi.yaml");
            expect(result.value.$capability).toBe("spi");
        });

        test('get_platform_ops returns error for unknown ops', () => {
            const result = handler.get_platform_ops("unknown");
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('clear_platform_ops removes all ops', () => {
            handler.add_platform_ops("spi_ops", make_platform_ops("spi.yaml", "spi_ops", "spi"));
            handler.add_platform_ops("i2c_ops", make_platform_ops("i2c.yaml", "i2c_ops", "i2c"));
            handler.clear_platform_ops();
            expect(handler.list_platform_ops()).toEqual([]);
        });

        test('find_any finds platform_ops', () => {
            handler.add_platform_ops("spi_ops", make_platform_ops("spi.yaml", "spi_ops", "spi"));
            const result = handler.find_any("spi_ops");
            expect(result).toBeDefined();
            expect(result?.$id).toBe("spi.yaml");
        });

        test('find_any finds symbols', () => {
            handler.add_symbol("my_struct", make_struct("test.yaml", "test"));
            const result = handler.find_any("my_struct");
            expect(result).toBeDefined();
            expect(result?.$id).toBe("test.yaml");
        });

        test('find_any returns undefined for unknown', () => {
            const result = handler.find_any("unknown");
            expect(result).toBeUndefined();
        });
    });

    describe('Property Values', () => {
        test('set_value sets property value', () => {
            const ruleset = make_struct("test/foo.yaml", "foo", [
                { _t: "NumberProperty", name: "count", description: "", type: "uint32_t" }
            ]);
            handler.add_symbol("my_foo", ruleset);
            const result = handler.set_value("my_foo", "count", 42);
            expectOk(result);
            const get_result = handler.get_value("my_foo", "count");
            expectOk(get_result);
            expect(get_result.value).toBe(42);
        });

        test('set_value returns error for unknown symbol', () => {
            const result = handler.set_value("unknown", "count", 42);
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('set_value returns error for unknown property', () => {
            const ruleset = make_struct("test/foo.yaml", "foo", []);
            handler.add_symbol("my_foo", ruleset);
            const result = handler.set_value("my_foo", "unknown", 42);
            expectError(result);
            expectErrorContains(result, "not found");
        });
    });

    describe('suggest_for_include', () => {
        test('returns matching symbols', () => {
            handler.add_symbol("spi1", make_struct("no-os/spi.yaml", "spi"));
            handler.add_symbol("spi2", make_struct("no-os/spi.yaml", "spi"));
            handler.add_symbol("i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const include = make_include("spi", "no-os/spi.yaml");
            const suggestions = handler.suggest_for_include(include);
            expect(suggestions).toEqual(["spi1", "spi2"]);
        });

        test('returns empty array when no matches', () => {
            handler.add_symbol("i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const include = make_include("spi", "no-os/spi.yaml");
            const suggestions = handler.suggest_for_include(include);
            expect(suggestions).toEqual([]);
        });
    });

    describe('suggest_for_union', () => {
        test('returns matching symbols for member', () => {
            handler.add_symbol("spi1", make_struct("no-os/spi.yaml", "spi"));
            handler.add_symbol("i2c1", make_struct("no-os/i2c.yaml", "i2c"));

            const union = make_union("comm", [
                make_include("spi", "no-os/spi.yaml"),
                make_include("i2c", "no-os/i2c.yaml"),
            ]);
            const result = handler.suggest_for_union(union, "spi");
            expectOk(result);
            expect(result.value).toEqual(["spi1"]);
        });

        test('returns error for unknown member', () => {
            const union = make_union("comm", [
                make_include("spi", "no-os/spi.yaml"),
            ]);
            const result = handler.suggest_for_union(union, "uart");
            expectError(result);
            expectErrorContains(result, "Unknown union member");
        });
    });

    describe('suggest_for_array', () => {
        test('returns matching symbols for array element', () => {
            handler.add_symbol("gpio1", make_struct("no-os/gpio.yaml", "gpio"));
            handler.add_symbol("gpio2", make_struct("no-os/gpio.yaml", "gpio"));

            const array = make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"));
            const result = handler.suggest_for_array(array);
            expectOk(result);
            expect(result.value).toEqual(["gpio1", "gpio2"]);
        });

        test('returns error for non-include element', () => {
            const array: ArrayProperty = {
                _t: "ArrayProperty",
                name: "values",
                description: "",
                size: 2,
                element: { _t: "NumberProperty", name: "element", description: "", type: "uint32_t" }
            };
            const result = handler.suggest_for_array(array);
            expectError(result);
            expectErrorContains(result, "not an include");
        });
    });

    describe('Persistence', () => {
        test('export_workfile returns a copy', () => {
            handler.add_symbol("foo", make_struct("foo.yaml", "foo"));
            const exported = handler.export_workfile();
            expect(exported.symbols["foo"].$id).toBe("foo.yaml");

            exported.symbols["foo"].$id = "changed.yaml";
            const second_export = handler.export_workfile();
            expect(second_export.symbols["foo"].$id).toBe("foo.yaml");
        });

        test('load_workfile replaces current state', () => {
            handler.add_symbol("foo", make_struct("foo.yaml", "foo"));
            handler.load_workfile({ platform_ops: {}, symbols: { "bar": make_struct("bar.yaml", "bar") } });
            expect(handler.list_symbols()).toEqual(["bar"]);
        });
    });

    describe('load_platform', () => {
        const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');

        test('loads max32690 platform ops from real files', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            const result = handler.load_platform(scan_result.value);

            expectOk(result);
            expect(result.value.available_structs).toHaveLength(5);
            expect(result.value.available_structs).toContain('platforms/maxim/max32690/max_spi_init_param.yaml');

            const ops_list = handler.list_platform_ops();
            expect(ops_list).toHaveLength(7);
            expect(ops_list).toContain('max_spi_ops');
            expect(ops_list).toContain('max_i2c_ops');
            expect(ops_list).toContain('max_gpio_ops');
        });

        test('clears existing ops before loading', () => {
            handler.add_platform_ops('old_ops', make_platform_ops('old.yaml', 'old_ops', 'old'));

            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            handler.load_platform(scan_result.value);

            expect(handler.list_platform_ops()).not.toContain('old_ops');
            expect(handler.list_platform_ops()).toContain('max_spi_ops');
        });

        test('loaded ops can be found with find_any', () => {
            const scan_result = scan_platform(PLATFORM_PATH);
            expectOk(scan_result);

            handler.load_platform(scan_result.value);

            const spi_ops = handler.find_any('max_spi_ops');
            expect(spi_ops).toBeDefined();
            expect(spi_ops?._t).toBe('BindingPlatformOps');
        });

        test('returns error if binding is not platform_ops', () => {
            const manifest = { ops: ['platforms/maxim/max32690/max_spi_init_param.yaml'], structs: [] };

            const result = handler.load_platform(manifest);
            expectError(result);
            expectErrorContains(result, 'Expected platform_ops');
        });
    });
});
