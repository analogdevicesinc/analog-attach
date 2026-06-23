import { describe, test, expect, beforeEach } from 'vitest';
import { WorkfileHandler } from '../../src/workfile_handler/workfile_handler';
import { RulesetStruct, RulesetType, IncludeProperty, UnionProperty, ArrayProperty } from '../../src/bindings_parser/types';
import { expectOk, expectError, expectErrorPath, expectErrorContains } from '../test_utils';

function make_struct(id: string, name: string, properties: RulesetStruct['properties'] = []): RulesetStruct {
    return {
        _t: "BindingStuct",
        $id: id,
        $type: RulesetType.BT_STRUCT,
        $name: name,
        $description: "Test struct",
        $ranking: 4,
        $sources: { headers: ["test.h"] },
        properties,
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

describe('WorkfileHandler', () => {
    let handler: WorkfileHandler;

    beforeEach(() => {
        handler = new WorkfileHandler();
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

    describe('validate_include', () => {
        test('validates matching include', () => {
            const spi_ruleset = make_struct("no-os/spi.yaml", "spi_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_include("spi", "no-os/spi.yaml", "my_spi")
            ]);
            handler.add_symbol("my_spi", spi_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_include("my_device", "spi");
            expectOk(result);
        });

        test('returns error when value not set', () => {
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_include("spi", "no-os/spi.yaml")
            ]);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_include("my_device", "spi");
            expectError(result);
            expectErrorContains(result, "no value set");
            expectErrorPath(result, "my_device.spi.value");
        });

        test('returns error when target symbol not found', () => {
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_include("spi", "no-os/spi.yaml", "nonexistent")
            ]);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_include("my_device", "spi");
            expectError(result);
            expectErrorContains(result, "not found");
            expectErrorPath(result, "my_device.spi.value");
        });

        test('returns error on type mismatch', () => {
            const wrong_ruleset = make_struct("no-os/i2c.yaml", "i2c_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_include("spi", "no-os/spi.yaml", "my_i2c")
            ]);
            handler.add_symbol("my_i2c", wrong_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_include("my_device", "spi");
            expectError(result);
            expectErrorContains(result, "Type mismatch");
            expectErrorPath(result, "my_device.spi.value");
        });
    });

    describe('validate_union', () => {
        test('validates matching union member', () => {
            const spi_ruleset = make_struct("no-os/spi.yaml", "spi_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_union("comm", [
                    make_include("spi", "no-os/spi.yaml"),
                    make_include("i2c", "no-os/i2c.yaml"),
                ], { "spi": "my_spi" })
            ]);
            handler.add_symbol("my_spi", spi_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_union("my_device", "comm");
            expectOk(result);
        });

        test('returns error when value not set', () => {
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_union("comm", [
                    make_include("spi", "no-os/spi.yaml"),
                ])
            ]);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_union("my_device", "comm");
            expectError(result);
            expectErrorContains(result, "no value set");
            expectErrorPath(result, "my_device.comm.value");
        });

        test('returns error for unknown union member', () => {
            const spi_ruleset = make_struct("no-os/spi.yaml", "spi_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_union("comm", [
                    make_include("spi", "no-os/spi.yaml"),
                ], { "uart": "my_spi" })
            ]);
            handler.add_symbol("my_spi", spi_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_union("my_device", "comm");
            expectError(result);
            expectErrorContains(result, "Unknown union member");
            expectErrorPath(result, "my_device.comm.value.uart");
        });

        test('returns error on type mismatch', () => {
            const i2c_ruleset = make_struct("no-os/i2c.yaml", "i2c_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_union("comm", [
                    make_include("spi", "no-os/spi.yaml"),
                ], { "spi": "my_i2c" })
            ]);
            handler.add_symbol("my_i2c", i2c_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_union("my_device", "comm");
            expectError(result);
            expectErrorContains(result, "Type mismatch");
            expectErrorPath(result, "my_device.comm.value.spi");
        });
    });

    describe('validate_array', () => {
        test('validates matching array elements', () => {
            const gpio_ruleset = make_struct("no-os/gpio.yaml", "gpio_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), ["gpio1", "gpio2"])
            ]);
            handler.add_symbol("gpio1", gpio_ruleset);
            handler.add_symbol("gpio2", gpio_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_array("my_device", "gpios");
            expectOk(result);
        });

        test('returns error when value not set', () => {
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"))
            ]);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_array("my_device", "gpios");
            expectError(result);
            expectErrorContains(result, "no value set");
            expectErrorPath(result, "my_device.gpios.value");
        });

        test('returns error when array size mismatch', () => {
            const gpio_ruleset = make_struct("no-os/gpio.yaml", "gpio_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_array("gpios", 3, make_include("element", "no-os/gpio.yaml"), ["gpio1", "gpio2"])
            ]);
            handler.add_symbol("gpio1", gpio_ruleset);
            handler.add_symbol("gpio2", gpio_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_array("my_device", "gpios");
            expectError(result);
            expectErrorContains(result, "must have 3 elements");
            expectErrorPath(result, "my_device.gpios.value");
        });

        test('returns error when element not found', () => {
            const gpio_ruleset = make_struct("no-os/gpio.yaml", "gpio_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), ["gpio1", "nonexistent"])
            ]);
            handler.add_symbol("gpio1", gpio_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_array("my_device", "gpios");
            expectError(result);
            expectErrorContains(result, "not found");
            expectErrorPath(result, "my_device.gpios.value.[1]");
        });

        test('returns error on type mismatch at index', () => {
            const gpio_ruleset = make_struct("no-os/gpio.yaml", "gpio_init_param");
            const spi_ruleset = make_struct("no-os/spi.yaml", "spi_init_param");
            const device_ruleset = make_struct("device.yaml", "device_init_param", [
                make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), ["gpio1", "my_spi"])
            ]);
            handler.add_symbol("gpio1", gpio_ruleset);
            handler.add_symbol("my_spi", spi_ruleset);
            handler.add_symbol("my_device", device_ruleset);

            const result = handler.validate_array("my_device", "gpios");
            expectError(result);
            expectErrorContains(result, "Type mismatch");
            expectErrorPath(result, "my_device.gpios.value.[1]");
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
            handler.load_workfile({ symbols: { "bar": make_struct("bar.yaml", "bar") } });
            expect(handler.list_symbols()).toEqual(["bar"]);
        });
    });
});
