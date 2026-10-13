import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
    create_workfile,
    add_symbol,
    get_symbol,
    remove_symbol,
    list_symbols,
    find_any,
    set_value,
    clear_value,
    mark_auto,
    get_value,
    suggest_for_include,
    suggest_for_union,
    suggest_for_array,
    suggest_platform_ops,
    suggest_platform_extra,
    suggest_for_property,
    list_available_structs,
    export_minimal,
    import_minimal,
    clone_workfile,
    rename_symbol,
    resolve_reference
} from '../../src/workfile_handler/workfile_handler';
import { Workfile } from '../../src/workfile_handler/types';
import {
    RulesetStruct,
    RulesetType,
    IncludeProperty,
    UnionProperty,
    ArrayProperty,
    RulesetPlatformOps,
    RulesetExtern,
    EnumProperty,
    BooleanProperty,
    PlatformOpsProperty,
    PlatformExtraProperty
} from '../../src/ruleset_parser/types';
import { expectOk, expectError, expectErrorContains, setup_test_config, teardown_test_config, setup_no_config, teardown_no_config, FIXTURE_SOC, FIXTURE_BOARD } from '../test_utilities';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import minimal_workfile_spi from './fixtures/minimal_workfile_spi.json';

// A struct is identified by its $symbol: that is what an `include:` names and what the
// registry keys on. Build facts live in the module.yml of whichever module ships it.
function make_struct(name: string, properties: RulesetStruct['properties'] = []): RulesetStruct {
    return {
        _t: "RulesetStruct",
        $type: RulesetType.RT_STRUCT,
        $symbol: name,
        $description: "Test struct",
        properties,
    };
}

function make_extern(symbol: string, provides: string, array?: boolean): RulesetExtern {
    return {
        _t: "RulesetExtern",
        $type: RulesetType.RT_EXTERN,
        $symbol: symbol,
        $description: "Test extern",
        // An extern matches an `include:` on the TYPE it provides, not on its own symbol:
        // the symbol names the global, $provides names the type it has.
        $provides: provides,
        $array: array,
    };
}

function make_platform_ops(name: string, capability?: string): RulesetPlatformOps {
    return {
        _t: "RulesetPlatformOps",
        $type: RulesetType.RT_PLATFORM_OPS,
        $symbol: name,
        $description: "Test ops",
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


describe('workfile_handler', () => {
    let workfile: Workfile;

    beforeEach(() => {
        setup_test_config();
        // The chip the fixture board carries. A workfile names one from the start:
        // export_minimal refuses to write a workfile that does not say what it targets.
        const result = create_workfile(FIXTURE_SOC);
        expectOk(result);
        workfile = result.value;
    });

    afterEach(() => {
        teardown_test_config();
    });

    describe('Symbol CRUD', () => {
        test('add_symbol adds a new symbol', () => {
            const ruleset = make_struct("foo");
            const result = add_symbol(workfile, "my_foo", ruleset);
            expectOk(result);
            expect(list_symbols(workfile)).toContain("my_foo");
        });

        test('add_symbol rejects duplicate names', () => {
            const ruleset = make_struct("foo");
            add_symbol(workfile, "my_foo", ruleset);
            const result = add_symbol(workfile, "my_foo", ruleset);
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('get_symbol returns existing symbol', () => {
            const ruleset = make_struct("foo");
            add_symbol(workfile, "my_foo", ruleset);
            const result = get_symbol(workfile, "my_foo");
            expectOk(result);
            expect(result.value.$symbol).toBe("foo");
        });

        test('get_symbol returns error for unknown symbol', () => {
            const result = get_symbol(workfile, "unknown");
            expectError(result);
            expectErrorContains(result, "does not exist");
        });

        test('remove_symbol removes existing symbol', () => {
            const ruleset = make_struct("foo");
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
            add_symbol(workfile, "foo", make_struct("a"));
            add_symbol(workfile, "bar", make_struct("b"));
            add_symbol(workfile, "baz", make_struct("c"));
            expect(list_symbols(workfile)).toEqual(["foo", "bar", "baz"]);
        });

        test('add_symbol rejects name that conflicts with platform_ops', () => {
            workfile.platform_ops["spi_ops"] = make_platform_ops("spi_ops", "spi");
            const result = add_symbol(workfile, "spi_ops", make_struct("test"));
            expectError(result);
            expectErrorContains(result, "conflicts with platform ops");
        });
    });

    describe('rename_symbol', () => {
        test('renames the symbol key', () => {
            add_symbol(workfile, "old", make_struct("foo"));
            expectOk(rename_symbol(workfile, "old", "renamed"));
            expect(list_symbols(workfile)).toContain("renamed");
            expect(list_symbols(workfile)).not.toContain("old");
        });

        test('returns error for unknown symbol', () => {
            const result = rename_symbol(workfile, "missing", "renamed");
            expectError(result);
            expectErrorContains(result, "not found");
        });

        test('rejects an invalid C name', () => {
            add_symbol(workfile, "old", make_struct("foo"));
            const result = rename_symbol(workfile, "old", "1bad");
            expectError(result);
        });

        test('rejects a name that already exists', () => {
            add_symbol(workfile, "a", make_struct("foo"));
            add_symbol(workfile, "b", make_struct("foo"));
            const result = rename_symbol(workfile, "a", "b");
            expectError(result);
            expectErrorContains(result, "already exists");
        });

        test('rewrites an include reference held by another symbol', () => {
            add_symbol(workfile, "child", make_struct("child"));
            add_symbol(workfile, "parent", make_struct("parent", [
                make_include("dev", "child", "child")
            ]));
            expectOk(rename_symbol(workfile, "child", "child_renamed"));
            const dev = get_value(workfile, "parent", "dev");
            expectOk(dev);
            expect(dev.value).toBe("child_renamed");
        });

        test('rewrites a platform_extra reference held by another symbol', () => {
            add_symbol(workfile, "child", make_struct("child"));
            const extra: PlatformExtraProperty = {
                _t: "PlatformExtraProperty", name: "extra", description: "", type: "platform_extra", value: "child"
            };
            add_symbol(workfile, "parent", make_struct("parent", [extra]));
            expectOk(rename_symbol(workfile, "child", "child_renamed"));
            const value = get_value(workfile, "parent", "extra");
            expectOk(value);
            expect(value.value).toBe("child_renamed");
        });

        test('rewrites matching members of a union reference', () => {
            add_symbol(workfile, "child", make_struct("child"));
            add_symbol(workfile, "other", make_struct("other"));
            add_symbol(workfile, "parent", make_struct("parent", [
                make_union("u", [
                    make_include("m1", "child"),
                    make_include("m2", "other"),
                ], { m1: "child", m2: "other" })
            ]));
            expectOk(rename_symbol(workfile, "child", "child_renamed"));
            const value = get_value(workfile, "parent", "u");
            expectOk(value);
            expect(value.value).toEqual({ m1: "child_renamed", m2: "other" });
        });

        test('rewrites matching entries of an array reference', () => {
            add_symbol(workfile, "child", make_struct("child"));
            add_symbol(workfile, "parent", make_struct("parent", [
                make_array("arr", 2, make_include("el", "child"), ["child", "other"])
            ]));
            expectOk(rename_symbol(workfile, "child", "child_renamed"));
            const value = get_value(workfile, "parent", "arr");
            expectOk(value);
            expect(value.value).toEqual(["child_renamed", "other"]);
        });

        test('leaves unrelated references untouched', () => {
            add_symbol(workfile, "child", make_struct("child"));
            add_symbol(workfile, "parent", make_struct("parent", [
                make_include("dev", "child", "child")
            ]));
            expectOk(rename_symbol(workfile, "parent", "parent_renamed"));
            // child's reference target was not renamed, so the value stays "child".
            const value = get_value(workfile, "parent_renamed", "dev");
            expectOk(value);
            expect(value.value).toBe("child");
        });
    });

    describe('find_any', () => {
        test('find_any finds platform_ops', () => {
            workfile.platform_ops["spi_ops"] = make_platform_ops("spi_ops", "spi");
            const result = find_any(workfile, "spi_ops");
            expect(result).toBeDefined();
            expect(result?.$symbol).toBe("spi_ops");
        });

        test('find_any finds symbols', () => {
            add_symbol(workfile, "my_struct", make_struct("test"));
            const result = find_any(workfile, "my_struct");
            expect(result).toBeDefined();
            expect(result?.$symbol).toBe("test");
        });

        test('find_any returns undefined for unknown', () => {
            const result = find_any(workfile, "unknown");
            expect(result).toBeUndefined();
        });
    });

    describe('Property Values', () => {
        test('set_value sets property value', () => {
            const ruleset = make_struct("foo", [
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
            const ruleset = make_struct("foo", []);
            add_symbol(workfile, "my_foo", ruleset);
            const result = set_value(workfile, "my_foo", "unknown", 42);
            expectError(result);
            expectErrorContains(result, "not found");
        });

        // A readonly field is filled in by generated code — a descriptor member by its
        // init function, a struct field by the target template — so a user value would
        // either be overwritten or contradict what the code does.
        test('set_value refuses a readonly property', () => {
            const ruleset = make_struct("foo", [
                { _t: "NumberProperty", name: "nb_devices", description: "", type: "uint32_t", readonly: true }
            ]);
            add_symbol(workfile, "my_foo", ruleset);
            const result = set_value(workfile, "my_foo", "nb_devices", 3);
            expectError(result);
            expectErrorContains(result, "filled in by generated code");
        });
    });

    describe('suggest_for_include', () => {
        test('returns matching symbols', () => {
            add_symbol(workfile, "spi1", make_struct("spi"));
            add_symbol(workfile, "spi2", make_struct("spi"));
            add_symbol(workfile, "i2c1", make_struct("i2c"));

            const include = make_include("spi", "spi");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toEqual(["spi1", "spi2"]);
            expect(suggestions.value.types).toEqual(["spi"]);
        });

        test('returns empty values when no matches', () => {
            add_symbol(workfile, "i2c1", make_struct("i2c"));

            const include = make_include("spi", "spi");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toBeUndefined();
            expect(suggestions.value.types).toEqual(["spi"]);
        });

        test('returns enum values when include points to enum', () => {
            const include = make_include("channel_mode", "test_spi_mode");
            const suggestions = suggest_for_include(workfile, include);
            expectOk(suggestions);
            expect(suggestions.value.values).toContain("TEST_SPI_MODE_0");
            expect(suggestions.value.values).toContain("TEST_SPI_MODE_3");
            expect(suggestions.value.types).toBeUndefined();
        });
    });

    describe('suggest_for_union', () => {
        test('returns matching symbols for member', () => {
            add_symbol(workfile, "spi1", make_struct("spi"));
            add_symbol(workfile, "i2c1", make_struct("i2c"));

            const union = make_union("comm", [
                make_include("spi", "spi"),
                make_include("i2c", "i2c"),
            ]);
            const result = suggest_for_union(workfile, union, "spi");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1"]);
            expect(result.value.types).toEqual(["spi"]);
        });

        test('returns error for unknown member', () => {
            const union = make_union("comm", [
                make_include("spi", "spi"),
            ]);
            const result = suggest_for_union(workfile, union, "uart");
            expectError(result);
            expectErrorContains(result, "Unknown union member");
        });
    });

    describe('suggest_for_array', () => {
        test('returns matching symbols for array element', () => {
            add_symbol(workfile, "gpio1", make_struct("gpio"));
            add_symbol(workfile, "gpio2", make_struct("gpio"));

            const array = make_array("gpios", 2, make_include("element", "gpio"));
            const result = suggest_for_array(workfile, array);
            expectOk(result);
            expect(result.value.values).toEqual(["gpio1", "gpio2"]);
            expect(result.value.types).toEqual(["gpio"]);
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
            add_symbol(workfile, "foo", make_struct("foo"));
            const cloned = clone_workfile(workfile);
            expect(cloned.symbols["foo"].$symbol).toBe("foo");

            cloned.symbols["foo"].$id = "changed.yaml";
            expect(workfile.symbols["foo"].$symbol).toBe("foo");
        });
    });

    describe('suggest_for_property', () => {
        test('suggests enum values', () => {
            const struct = make_struct("test", [
                { _t: "EnumProperty", name: "mode", description: "", values: ["MODE_A", "MODE_B", "MODE_C"] } as EnumProperty
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "mode");
            expectOk(result);
            expect(result.value).toEqual({ values: ["MODE_A", "MODE_B", "MODE_C"] });
        });

        test('suggests boolean values', () => {
            const struct = make_struct("test", [
                { _t: "BooleanProperty", name: "enabled", description: "", type: "bool", default: false } as BooleanProperty
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "enabled");
            expectOk(result);
            expect(result.value).toEqual({ values: ["true", "false"] });
        });

        test('suggests matching symbols for include property', () => {
            add_symbol(workfile, "spi1", make_struct("spi"));
            add_symbol(workfile, "spi2", make_struct("spi"));

            const struct = make_struct("test", [
                make_include("spi_ref", "spi")
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "spi_ref");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1", "spi2"]);
            expect(result.value.types).toEqual(["spi"]);
        });

        test('suggests union member names when no member specified', () => {
            const struct = make_struct("test", [
                make_union("comm", [
                    make_include("spi_init", "spi"),
                    make_include("i2c_init", "i2c"),
                ])
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "comm");
            expectOk(result);
            expect(result.value).toEqual({ values: ["spi_init", "i2c_init"] });
        });

        test('suggests symbols for union member when member specified', () => {
            add_symbol(workfile, "spi1", make_struct("spi"));

            const struct = make_struct("test", [
                make_union("comm", [
                    make_include("spi_init", "spi"),
                    make_include("i2c_init", "i2c"),
                ])
            ]);
            add_symbol(workfile, "my_struct", struct);

            const result = suggest_for_property(workfile, "my_struct", "comm", "spi_init");
            expectOk(result);
            expect(result.value.values).toEqual(["spi1"]);
            expect(result.value.types).toEqual(["spi"]);
        });

        test('returns empty object for number property', () => {
            const struct = make_struct("test", [
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
            add_symbol(workfile, "my_struct", make_struct("test", []));
            const result = suggest_for_property(workfile, "my_struct", "unknown");
            expectError(result);
        });
    });

    describe('suggest_platform_ops', () => {

        test('suggests ops matching capability', () => {
            workfile.platform_ops['test_spi_ops'] = make_platform_ops('test_spi_ops', 'spi');
            workfile.platform_ops['test_gpio_ops'] = make_platform_ops('test_gpio_ops', 'gpio');

            const property: PlatformOpsProperty = {
                _t: "PlatformOpsProperty",
                name: "platform_ops",
                description: "",
                type: "platform_ops",
                capability: ["spi"]
            };

            const result = suggest_platform_ops(workfile, property);
            expectOk(result);
            expect(result.value.values).toContain("test_spi_ops");
            expect(result.value.values).not.toContain("test_gpio_ops");
        });

        test('suggests ops from allowed list when override present', () => {
            workfile.platform_ops['test_spi_ops'] = make_platform_ops('test_spi_ops', 'spi');

            const property: PlatformOpsProperty = {
                _t: "PlatformOpsProperty",
                name: "platform_ops",
                description: "",
                type: "platform_ops",
                allowed: ["test_spi_ops"]
            };

            const result = suggest_platform_ops(workfile, property);
            expectOk(result);
            expect(result.value).toEqual({ values: ["test_spi_ops"] });
        });
    });

    describe('suggest_platform_extra', () => {

        test('suggests extras matching capability', () => {
            // What makes a struct a platform extra is that a PLATFORM module ships it, so
            // the candidate is the fixture platform's own struct. A locally built struct
            // with the same capability is not one, and must not be offered.
            const platform_extra = load_resolved_ruleset("test_spi_extra");
            expectOk(platform_extra);
            add_symbol(workfile, "my_spi_extra", platform_extra.value);

            const local: RulesetStruct = {
                ...make_struct("locally_made"),
                $capability: "spi"
            };
            add_symbol(workfile, "my_local_extra", local);

            const parent = make_struct("spi");

            const property: PlatformExtraProperty = {
                _t: "PlatformExtraProperty",
                name: "extra",
                description: "",
                type: "platform_extra",
                capability: ["spi"]
            };

            const result = suggest_platform_extra(workfile, property, parent);
            expectOk(result);
            expect(result.value.values).toContain("my_spi_extra");
            expect(result.value.values).not.toContain("my_local_extra");
        });
    });

    describe('list_available_structs', () => {
        test('groups instantiable symbols by the module that ships them', () => {
            // Provenance is which module indexed a symbol, which generalises to however many
            // drivers and platforms are configured.
            const result = list_available_structs(workfile);
            expectOk(result);

            expect(Object.keys(result.value.by_module).sort()).toEqual(['capi-test', 'platform-test', 'testpart']);
            expect(result.value.by_module['testpart']).toContain('testpart_init_param');
            expect(result.value.all).toContain('test_spi_device');

            // Enums are not instantiable: they only lower into an including property.
            expect(result.value.all).not.toContain('test_spi_mode');
        });

        test('offers the selected board\'s own peripherals too', () => {
            workfile.board = FIXTURE_BOARD;
            const result = list_available_structs(workfile);
            expectOk(result);

            expect(result.value.by_module[FIXTURE_BOARD]).toContain('bsp_test_spi_cfg');
        });

        test('returns error when schemas_path not set', () => {
            setup_no_config();
            const result = list_available_structs(workfile);
            teardown_no_config();
            expectError(result);
        });
    });

    describe('value ownership', () => {
        // "$auto" names the values bootstrap owns; null is a value the user set to nothing.
        function spi_node(): RulesetStruct {
            const ruleset = load_resolved_ruleset('test_spi_config');
            expectOk(ruleset);
            expectOk(add_symbol(workfile, 'my_spi', ruleset.value));
            expectOk(set_value(workfile, 'my_spi', 'identifier', 1));
            expectOk(set_value(workfile, 'my_spi', 'dma_handle', 2));
            return workfile.symbols['my_spi'] as RulesetStruct;
        }

        function property(node: RulesetStruct, name: string) {
            const found = node.properties.find(candidate => candidate.name === name);
            expect(found).toBeDefined();
            return found!;
        }

        function reloaded(): Workfile {
            const exported = export_minimal(workfile);
            expectOk(exported);
            const imported = import_minimal(JSON.parse(JSON.stringify(exported.value)));
            expectOk(imported);
            return imported.value;
        }

        test('owned values are written as one "$auto" list, and only those', () => {
            spi_node();
            expectOk(mark_auto(workfile, 'my_spi', 'identifier'));

            const exported = export_minimal(workfile);
            expectOk(exported);
            expect(exported.value.symbols['my_spi']).toEqual({ $compatible: 'test_spi_config', $auto: ['identifier'], identifier: 1, dma_handle: 2 });
        });

        test('a node with no owned values has no "$auto" key', () => {
            spi_node();
            const exported = export_minimal(workfile);
            expectOk(exported);
            expect(exported.value.symbols['my_spi']).not.toHaveProperty('$auto');
        });

        test('ownership and cleared values survive a save and load', () => {
            spi_node();
            expectOk(mark_auto(workfile, 'my_spi', 'identifier'));
            expectOk(clear_value(workfile, 'my_spi', 'dma_handle'));

            const node = reloaded().symbols['my_spi'] as RulesetStruct;
            expect(property(node, 'identifier')).toMatchObject({ value: 1, auto: true });
            expect(property(node, 'dma_handle').value).toBeUndefined();
            expect(property(node, 'dma_handle').cleared).toBe(true);
        });

        test('a cleared value is written as null and reads as unset', () => {
            const node = spi_node();
            expectOk(mark_auto(workfile, 'my_spi', 'dma_handle'));
            expectOk(clear_value(workfile, 'my_spi', 'dma_handle'));

            // Cleared is the user's: no longer bootstrap's, and no value for anything to read.
            expect(property(node, 'dma_handle')).toMatchObject({ cleared: true });
            expect(property(node, 'dma_handle').auto).toBeUndefined();
            const exported = export_minimal(workfile);
            expectOk(exported);
            expect(exported.value.symbols['my_spi']?.dma_handle).toBeNull();
            expect(exported.value.symbols['my_spi']).not.toHaveProperty('$auto');
        });

        test('writing a value replaces a cleared one', () => {
            const node = spi_node();
            expectOk(clear_value(workfile, 'my_spi', 'dma_handle'));
            expectOk(set_value(workfile, 'my_spi', 'dma_handle', 3));
            expect(property(node, 'dma_handle').cleared).toBeUndefined();
            expect(property(node, 'dma_handle').value).toBe(3);
        });

        test('ownership needs a value to own', () => {
            spi_node();
            expectOk(clear_value(workfile, 'my_spi', 'dma_handle'));
            expectErrorContains(mark_auto(workfile, 'my_spi', 'dma_handle'), 'no value');
        });

        test('rename keeps ownership with the node', () => {
            spi_node();
            expectOk(mark_auto(workfile, 'my_spi', 'identifier'));
            expectOk(rename_symbol(workfile, 'my_spi', 'renamed_spi'));
            const exported = export_minimal(workfile);
            expectOk(exported);
            expect(exported.value.symbols['renamed_spi']?.$auto).toEqual(['identifier']);
        });

        test('"$auto" naming a value the node does not have is refused on load', () => {
            const minimal = { platform: FIXTURE_SOC, symbols: { my_spi: { $compatible: 'test_spi_config', $auto: ['identifier'] } } };
            expectErrorContains(import_minimal(minimal), 'no value for bootstrap to own');
        });
    });

    describe('export_minimal', () => {

        test('exports platform name and symbol values', () => {
            workfile.platform_ops['test_spi_ops'] = make_platform_ops('test_spi_ops', 'spi');

            const spi_result = load_resolved_ruleset("test_spi_config");
            expectOk(spi_result);
            add_symbol(workfile, "my_spi", spi_result.value);
            set_value(workfile, "my_spi", "identifier", 1);
            set_value(workfile, "my_spi", "dma_handle", 2);

            const result = export_minimal(workfile);
            expectOk(result);

            expect(result.value.platform).toBe(minimal_workfile_spi.platform);
            expect(result.value.symbols["my_spi"].$compatible).toBe(minimal_workfile_spi.symbols.my_spi.$compatible);
            expect(result.value.symbols["my_spi"]["identifier"]).toBe(minimal_workfile_spi.symbols.my_spi.identifier);
            expect(result.value.symbols["my_spi"]["dma_handle"]).toBe(minimal_workfile_spi.symbols.my_spi.dma_handle);
        });

        test('returns error when no platform loaded', () => {
            // The suite's workfiles name their chip, so this needs one that does not.
            const bare = create_workfile();
            expectOk(bare);
            workfile = bare.value;
            const result = export_minimal(workfile);
            expectError(result);
            expectErrorContains(result, "No platform loaded");
        });
    });

    describe('import_minimal', () => {
        test('imports minimal workfile and restores full state', () => {
            const minimal = {
                platform: FIXTURE_SOC,
                symbols: {
                    "my_spi": {
                        $compatible: "test_spi_config",
                        identifier: 1,
                        dma_handle: 2,
                    }
                }
            };

            const result = import_minimal(minimal);
            expectOk(result);

            const imported = result.value;
            expect(imported.platform).toBe(FIXTURE_SOC);
            expect(list_symbols(imported)).toContain("my_spi");

            const identifier = get_value(imported, "my_spi", "identifier");
            expectOk(identifier);
            expect(identifier.value).toBe(1);
        });

        test('returns error for unknown platform', () => {
            const minimal = {
                platform: "unknown_platform",
                symbols: {}
            };

            const result = import_minimal(minimal);
            expectError(result);
            expectErrorContains(result, "Unknown chip 'unknown_platform'");
        });

        test('round-trip: export then import produces same state', () => {
            workfile.platform_ops['test_spi_ops'] = make_platform_ops('test_spi_ops', 'spi');

            const spi_result = load_resolved_ruleset("test_spi_config");
            expectOk(spi_result);
            add_symbol(workfile, "test_spi", spi_result.value);
            set_value(workfile, "test_spi", "identifier", 42);
            set_value(workfile, "test_spi", "dma_handle", 3);

            const exported = export_minimal(workfile);
            expectOk(exported);

            const import_result = import_minimal(exported.value);
            expectOk(import_result);

            const workfile2 = import_result.value;
            // Platform ops are not part of a minimal workfile: they used to be reloaded
            // from the platform manifest, which no longer exists. Only the user's own
            // symbols and their values round-trip.
            expect(list_symbols(workfile2)).toContain("test_spi");

            const device_id = get_value(workfile2, "test_spi", "identifier");
            expectOk(device_id);
            expect(device_id.value).toBe(42);
        });

        test('round-trip preserves array values', () => {
            const modes = ["TEST_SPI_MODE_0", "TEST_SPI_MODE_3", "TEST_SPI_MODE_0"];
            const minimal = {
                platform: FIXTURE_SOC,
                symbols: {
                    "my_holder": { $compatible: "test_array_holder", modes }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_holder"]["modes"]).toEqual(modes);
        });

        test('round-trip preserves union values', () => {
            const minimal = {
                platform: FIXTURE_SOC,
                symbols: {
                    "my_dev": { $compatible: "test_spi_device", max_speed_hz: 1000000 },
                    "my_part": {
                        $compatible: "testpart_init_param",
                        dev_ready: true,
                        comm_init: { spi_dev: "my_dev" }
                    }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_part"]["comm_init"]).toEqual({ spi_dev: "my_dev" });
        });

        test('round-trip preserves boolean values', () => {
            // Both polarities: `false` must survive, which an omit-if-falsy exporter loses.
            const minimal = {
                platform: FIXTURE_SOC,
                symbols: {
                    "my_holder": { $compatible: "test_array_holder", flag: false },
                    "my_part": { $compatible: "testpart_init_param", dev_ready: true }
                }
            };

            const import_result = import_minimal(minimal);
            expectOk(import_result);

            const exported = export_minimal(import_result.value);
            expectOk(exported);

            expect(exported.value.symbols["my_holder"]["flag"]).toBe(false);
            expect(exported.value.symbols["my_part"]["dev_ready"]).toBe(true);
        });
    });

    describe('resolve_reference on externs', () => {
        // An extern names a global the library already compiles, so the expression is its
        // `$symbol` rather than the workfile node name the user picked.
        test('resolves to the library symbol, not the node name', () => {
            add_symbol(workfile, "my_dev",
                make_extern("iio_ad7124_device", "test_iio_device"));

            const resolved = resolve_reference(workfile, "my_dev");
            expect(resolved?.expr).toBe("iio_ad7124_device");
            expect(resolved?.$id).toBe("test_iio_device");
            expect(resolved?.runtime).toBe(false);
        });

        // A struct extern is a value, so a `pointer: true` consumer has to take its address.
        test('a struct extern is not a pointer', () => {
            add_symbol(workfile, "my_dev",
                make_extern("iio_ad7124_device", "test_iio_device"));

            expect(resolve_reference(workfile, "my_dev")?.pointer).toBe(false);
        });

        // An array name already decays to a pointer. Reporting it as one is what stops the
        // caller adding an `&`, which would give `struct x (*)[57]` instead of `struct x *`.
        test('an array extern reports itself as a pointer', () => {
            add_symbol(workfile, "my_regs",
                make_extern("ad7124_regs", "test/reg.yaml", true));

            expect(resolve_reference(workfile, "my_regs")?.pointer).toBe(true);
        });
    });

    describe('platform_vendor', () => {
        // The vendor comes from the platform module that supports the chip, which is also
        // what makes naming an unsupported chip an error rather than a silent miss.
        test('create_workfile resolves the vendor from the chip', () => {
            const result = create_workfile(FIXTURE_SOC);
            expectOk(result);
            expect(result.value.platform_vendor).toBe("testvendor");
        });

        test('import_minimal resolves it too', () => {
            const result = import_minimal({ platform: FIXTURE_SOC, symbols: {} });
            expectOk(result);
            expect(result.value.platform_vendor).toBe("testvendor");
        });

        test('a workfile with no chip has no vendor', () => {
            const result = create_workfile();
            expectOk(result);
            expect(result.value.platform_vendor).toBeUndefined();
        });
    });
});
