import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { validate_workfile } from '../../src/validator/validator';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { expectOk } from '../test_utilities';
import {
    RulesetStruct,
    RulesetType,
    RulesetPlatformOps,
    IncludeProperty,
    IncludeDescriptorProperty,
    UnionProperty,
    ArrayProperty,
    NumberProperty,
    BooleanProperty,
    EnumProperty,
    StringProperty,
    PlatformOpsProperty,
    PlatformExtraProperty
} from '../../src/ruleset_parser/types';
import { Workfile } from '../../src/workfile_handler/types';
import { scan_platform } from '../../src/workfile_handler/platform_scanner';
import { load_platform } from '../../src/workfile_handler/workfile_handler';

function make_struct(
    id: string,
    name: string,
    properties: RulesetStruct['properties'] = []
): RulesetStruct {
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

// Parse a child ruleset from a fixture so its $override block is lowered to real
// rules[] by the actual parser — override tests exercise lowering + engine
// end-to-end rather than hand-building internal Rule/Effect literals. The
// resulting struct's property VALUES are then set from `values` (parsing does
// not carry user values), so it behaves like a workfile instance.
function parse_override_fixture(name: string, values: Record<string, unknown> = {}): RulesetStruct {
    const yaml = fs.readFileSync(path.resolve(__dirname, 'fixtures/overrides', name), 'utf8');
    const result = parse_ruleset(yaml);
    expectOk(result);
    const struct = result.value as RulesetStruct;
    for (const [property_name, value] of Object.entries(values)) {
        const property = struct.properties.find(p => p.name === property_name);
        if (property) {
            property.value = value;
        }
    }
    return struct;
}

function make_number(name: string, options: Partial<NumberProperty> = {}): NumberProperty {
    return {
        _t: "NumberProperty",
        name,
        description: "",
        type: "uint32_t",
        ...options,
    };
}

function make_boolean(name: string, options: Partial<BooleanProperty> = {}): BooleanProperty {
    return {
        _t: "BooleanProperty",
        name,
        description: "",
        type: "bool",
        default: false,
        ...options,
    };
}

function make_string(name: string, options: Partial<StringProperty> = {}): StringProperty {
    return {
        _t: "StringProperty",
        name,
        description: "",
        type: "string",
        ...options,
    };
}

function make_enum(name: string, values: (string | number)[], options: Partial<EnumProperty> = {}): EnumProperty {
    return {
        _t: "EnumProperty",
        name,
        description: "",
        values,
        ...options,
    };
}

function make_include(name: string, include: string, options: Partial<IncludeProperty> = {}): IncludeProperty {
    return {
        _t: "IncludeProperty",
        name,
        description: "",
        include,
        ...options,
    };
}

function make_include_descriptor(name: string, include_descriptor: string, options: Partial<IncludeDescriptorProperty> = {}): IncludeDescriptorProperty {
    return {
        _t: "IncludeDescriptorProperty",
        name,
        description: "",
        include_descriptor,
        pointer: true,
        ...options,
    };
}

function make_union(name: string, members: IncludeProperty[], options: Partial<UnionProperty> = {}): UnionProperty {
    return {
        _t: "UnionProperty",
        name,
        description: "",
        members,
        ...options,
    };
}

function make_array(name: string, size: number, element: ArrayProperty['element'], options: Partial<ArrayProperty> = {}): ArrayProperty {
    return {
        _t: "ArrayProperty",
        name,
        description: "",
        size,
        element,
        ...options,
    };
}

function make_workfile(symbols: Record<string, RulesetStruct>, platform_ops: Record<string, RulesetPlatformOps> = {}): Workfile {
    return { platform_ops, symbols };
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

function make_platform_ops_property(name: string, options: Partial<PlatformOpsProperty> = {}): PlatformOpsProperty {
    return {
        _t: "PlatformOpsProperty",
        name,
        description: "",
        type: "platform_ops",
        ...options,
    };
}

function make_platform_extra_property(name: string, options: Partial<PlatformExtraProperty> = {}): PlatformExtraProperty {
    return {
        _t: "PlatformExtraProperty",
        name,
        description: "",
        type: "platform_extra",
        ...options,
    };
}

function make_struct_with_capability(
    id: string,
    name: string,
    capability: string,
    properties: RulesetStruct['properties'] = []
): RulesetStruct {
    return {
        _t: "RulesetStruct",
        $id: id,
        $type: RulesetType.RT_STRUCT,
        $symbol: name,
        $description: "Test struct",
        $ranking: 4,
        $sources: { headers: ["test.h"] },
        $capability: capability,
        properties,
    };
}

describe('validate_workfile', () => {
    describe('number property validation', () => {
        test('valid number passes', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { value: 42, minimum: 0, maximum: 100 })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('number below minimum fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { value: -5, minimum: 0 })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].path).toBe("my_struct.count");
            expect(result.errors[0].message).toContain("below");
        });

        test('number above maximum fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { value: 150, maximum: 100 })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].path).toBe("my_struct.count");
            expect(result.errors[0].message).toContain("above");
        });

        test('wrong type fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { value: "not a number" as any })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Expected number");
        });
    });

    describe('boolean property validation', () => {
        test('valid boolean passes', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_boolean("flag", { value: true })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('wrong type fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_boolean("flag", { value: "true" as any })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Expected boolean");
        });
    });

    describe('string property validation', () => {
        test('valid string passes', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_string("name", { value: "hello" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('wrong type fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_string("name", { value: 123 as any })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Expected string");
        });
    });

    describe('enum property validation', () => {
        test('valid enum value passes', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_enum("mode", ["fast", "slow"], { value: "fast" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('invalid enum value fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_enum("mode", ["fast", "slow"], { value: "medium" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Invalid value");
            expect(result.errors[0].message).toContain("fast, slow");
        });
    });

    describe('required property validation', () => {
        test('required property without value fails', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { required: true })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Required");
        });

        test('optional property without value passes', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { required: false })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('disabled property validation', () => {
        test('disabled property is skipped', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("count", { disabled: true, required: true })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('include property validation', () => {
        test('valid include passes', () => {
            const workfile = make_workfile({
                my_spi: make_struct("no-os/spi.yaml", "spi_init_param", []),
                my_device: make_struct("device.yaml", "device", [
                    make_include("spi", "no-os/spi.yaml", { value: "my_spi" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('include with missing target fails', () => {
            const workfile = make_workfile({
                my_device: make_struct("device.yaml", "device", [
                    make_include("spi", "no-os/spi.yaml", { value: "nonexistent" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not found");
        });

        test('include with type mismatch fails', () => {
            const workfile = make_workfile({
                my_i2c: make_struct("no-os/i2c.yaml", "i2c_init_param", []),
                my_device: make_struct("device.yaml", "device", [
                    make_include("spi", "no-os/spi.yaml", { value: "my_i2c" })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Type mismatch");
        });
    });

    describe('union property validation', () => {
        test('valid union passes', () => {
            const workfile = make_workfile({
                my_spi: make_struct("no-os/spi.yaml", "spi", []),
                my_device: make_struct("device.yaml", "device", [
                    make_union("comm", [
                        make_include("spi", "no-os/spi.yaml"),
                        make_include("i2c", "no-os/i2c.yaml"),
                    ], { value: { "spi": "my_spi" } })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('union with unknown member fails', () => {
            const workfile = make_workfile({
                my_spi: make_struct("no-os/spi.yaml", "spi", []),
                my_device: make_struct("device.yaml", "device", [
                    make_union("comm", [
                        make_include("spi", "no-os/spi.yaml"),
                    ], { value: { "uart": "my_spi" } })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Unknown union member");
        });

        test('union with multiple keys fails', () => {
            const workfile = make_workfile({
                my_spi: make_struct("no-os/spi.yaml", "spi", []),
                my_i2c: make_struct("no-os/i2c.yaml", "i2c", []),
                my_device: make_struct("device.yaml", "device", [
                    make_union("comm", [
                        make_include("spi", "no-os/spi.yaml"),
                        make_include("i2c", "no-os/i2c.yaml"),
                    ], { value: { "spi": "my_spi", "i2c": "my_i2c" } })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("exactly one key");
        });
    });

    describe('array property validation', () => {
        test('valid array passes', () => {
            const workfile = make_workfile({
                gpio1: make_struct("no-os/gpio.yaml", "gpio", []),
                gpio2: make_struct("no-os/gpio.yaml", "gpio", []),
                my_device: make_struct("device.yaml", "device", [
                    make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), { value: ["gpio1", "gpio2"] })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('array exceeding max size fails', () => {
            const workfile = make_workfile({
                gpio1: make_struct("no-os/gpio.yaml", "gpio", []),
                gpio2: make_struct("no-os/gpio.yaml", "gpio", []),
                gpio3: make_struct("no-os/gpio.yaml", "gpio", []),
                my_device: make_struct("device.yaml", "device", [
                    make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), { value: ["gpio1", "gpio2", "gpio3"] })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("exceeds maximum size");
        });

        test('array with fewer elements than max passes', () => {
            const workfile = make_workfile({
                gpio1: make_struct("no-os/gpio.yaml", "gpio", []),
                my_device: make_struct("device.yaml", "device", [
                    make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), { value: ["gpio1"] })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('array with missing element fails', () => {
            const workfile = make_workfile({
                gpio1: make_struct("no-os/gpio.yaml", "gpio", []),
                my_device: make_struct("device.yaml", "device", [
                    make_array("gpios", 2, make_include("element", "no-os/gpio.yaml"), { value: ["gpio1", "nonexistent"] })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not found");
            expect(result.errors[0].path).toContain("[1]");
        });

        test('array with valid enum values passes', () => {
            const workfile = make_workfile({
                my_device: make_struct("device.yaml", "device", [
                    make_array("modes", 3, make_include("element", "devices/ad5592r/enums/ad5592r_channel_mode.yaml"), {
                        value: ["CH_MODE_ADC", "CH_MODE_DAC", "CH_MODE_UNUSED"]
                    })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('array with invalid enum value fails', () => {
            const workfile = make_workfile({
                my_device: make_struct("device.yaml", "device", [
                    make_array("modes", 3, make_include("element", "devices/ad5592r/enums/ad5592r_channel_mode.yaml"), {
                        value: ["CH_MODE_ADC", "INVALID_MODE", "CH_MODE_UNUSED"]
                    })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Invalid value");
            expect(result.errors[0].message).toContain("INVALID_MODE");
        });

        test('array with non-array value fails', () => {
            const workfile = make_workfile({
                my_device: make_struct("device.yaml", "device", [
                    make_array("modes", 3, make_include("element", "devices/ad5592r/enums/ad5592r_channel_mode.yaml"), {
                        value: "not an array" as unknown as string[]
                    })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Expected array");
        });
    });

    // Override tests author the child ruleset as YAML and run it through the real
    // parser, so the $override block is lowered end-to-end. The parent is built with
    // the make_* helpers (it only needs property values) and links the child via an
    // include. Refs in a child override resolve to: self = the child (my_child),
    // parent = whatever includes it (my_parent).
    describe('static override validation', () => {
        test('$parent static override modifies constraints', () => {
            const child = parse_override_fixture("static_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("device_id", { value: 5, maximum: 10 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].path).toBe("my_parent.device_id");
            expect(result.errors[0].message).toContain("above");
            expect(result.errors[0].message).toContain("4");
        });

        test('$this static override does not affect parent', () => {
            // Child has its OWN device_id constrained to max 4 via a $this override.
            // The parent's same-named device_id (value 5) must stay unconstrained —
            // if scope leaked, 5 > 4 would fail. Child's own device_id (0) satisfies 4.
            const child = parse_override_fixture("static_this.yaml", { device_id: 0 });
            const parent = make_struct("parent.yaml", "parent", [
                make_number("device_id", { value: 5, maximum: 10 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('conditional override validation', () => {
        test('$if override applies when condition matches', () => {
            const child = parse_override_fixture("if_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_enum("mode", ["fast", "slow"], { value: "fast" }),
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].path).toBe("my_parent.speed");
            expect(result.errors[0].message).toContain("below");
        });

        test('$if override does not apply when condition does not match', () => {
            const child = parse_override_fixture("if_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_enum("mode", ["fast", "slow"], { value: "slow" }),
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('mutex validation', () => {
        test('mutex with one value passes', () => {
            const child = parse_override_fixture("mutex_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("opt_a", { value: 1 }),
                make_number("opt_b"),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('mutex with multiple values fails', () => {
            // Both opt_a and opt_b set: each disables the other, so both are
            // disabled-but-set. The engine reports each with its mutex reason.
            const child = parse_override_fixture("mutex_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("opt_a", { value: 1 }),
                make_number("opt_b", { value: 2 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            const messages = result.errors.map(error => error.message).join(" | ");
            expect(messages).toContain("mutually exclusive");
            expect(messages).toContain("opt_a");
            expect(messages).toContain("opt_b");
        });

        test('$this mutex does not affect parent', () => {
            // Child declares its own opt_a/opt_b and a $this mutex over them; both
            // are left unset so the mutex is satisfied. The parent's same-named
            // both-set properties are unaffected (no mutex on the parent).
            const child = parse_override_fixture("mutex_this.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("opt_a", { value: 1 }),
                make_number("opt_b", { value: 2 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('switch override validation', () => {
        test('$switch override applies matching case', () => {
            const child = parse_override_fixture("switch_parent.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_enum("mode", ["fast", "slow"], { value: "fast" }),
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].path).toBe("my_parent.speed");
            expect(result.errors[0].message).toContain("below");
        });

        test('$switch override does not apply non-matching case', () => {
            const child = parse_override_fixture("switch_parent_single.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_enum("mode", ["fast", "slow"], { value: "slow" }),
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('$switch with $this scope checks child property', () => {
            const child = parse_override_fixture("switch_this.yaml", { child_mode: "a" });
            const parent = make_struct("parent.yaml", "parent", [
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("below");
        });

        test('$switch skips when $on property not found', () => {
            const child = parse_override_fixture("switch_missing_on.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('conditional override edge cases', () => {
        test('$if skips when condition target not found', () => {
            const child = parse_override_fixture("if_missing_target.yaml");
            const parent = make_struct("parent.yaml", "parent", [
                make_number("speed", { value: 50 }),
                make_include("extra", "child.yaml", { value: "my_child" })
            ]);

            const workfile = make_workfile({
                my_child: child,
                my_parent: parent
            });

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('multiple errors', () => {
        test('returns all errors, not just first', () => {
            const workfile = make_workfile({
                my_struct: make_struct("test.yaml", "test", [
                    make_number("a", { value: -1, minimum: 0 }),
                    make_number("b", { value: 200, maximum: 100 }),
                    make_number("c", { required: true })
                ])
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBe(3);
        });
    });

    describe('platform_ops validation', () => {
        test('valid platform_ops passes', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", { value: "spi_ops" })
                    ])
                },
                {
                    spi_ops: make_platform_ops("platform/spi_ops.yaml", "spi_ops", "spi")
                }
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('missing platform_ops symbol fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", { value: "nonexistent_ops" })
                    ])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not found");
        });

        test('capability mismatch fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", { value: "gpio_ops" })
                    ])
                },
                {
                    gpio_ops: make_platform_ops("platform/gpio_ops.yaml", "gpio_ops", "gpio")
                }
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Capability mismatch");
            expect(result.errors[0].message).toContain("gpio");
            expect(result.errors[0].message).toContain("spi");
        });

        test('no capability on parent skips capability check', () => {
            const workfile = make_workfile(
                {
                    my_struct: make_struct("test.yaml", "test", [
                        make_platform_ops_property("platform_ops", { value: "spi_ops" })
                    ])
                },
                {
                    spi_ops: make_platform_ops("platform/spi_ops.yaml", "spi_ops", "spi")
                }
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('no value skips validation (not required)', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops")
                    ])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('required platform_ops without value fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", { required: true })
                    ])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Required");
        });
    });

    describe('platform_extra validation', () => {
        test('valid platform_extra passes', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", { value: "my_spi_extra" })
                    ]),
                    my_spi_extra: make_struct_with_capability("platform/max_spi.yaml", "max_spi", "spi", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('missing platform_extra symbol fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", { value: "nonexistent" })
                    ])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not found");
        });

        test('capability mismatch fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", { value: "my_gpio_extra" })
                    ]),
                    my_gpio_extra: make_struct_with_capability("platform/max_gpio.yaml", "max_gpio", "gpio", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Capability mismatch");
            expect(result.errors[0].message).toContain("gpio");
            expect(result.errors[0].message).toContain("spi");
        });

        test('no capability on parent skips capability check', () => {
            const workfile = make_workfile(
                {
                    my_struct: make_struct("test.yaml", "test", [
                        make_platform_extra_property("extra", { value: "my_extra" })
                    ]),
                    my_extra: make_struct_with_capability("platform/extra.yaml", "extra", "spi", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('no value skips validation (not required)', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra")
                    ])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('required platform_extra without value fails when platform types exist', () => {
            // Load a real platform that has spi extra structs
            const PLATFORM_PATH = path.join(__dirname, '../bindings/schemas/platforms/maxim/max32690');
            const scan_result = scan_platform(PLATFORM_PATH);
            if (!scan_result.ok) throw new Error("Failed to scan platform");

            const workfile: Workfile = {
                platform: "max32690",
                platform_ops: {},
                symbols: {
                    my_spi: {
                        ...make_struct_with_capability("no-os/spi/no_os_spi_init_param.yaml", "no_os_spi_init_param", "spi", [
                            make_platform_extra_property("extra", { required: true })
                        ])
                    }
                }
            };
            load_platform(workfile, scan_result.value);

            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Required");
        });

        test('required platform_extra without value passes if no valid extras exist', () => {
            // Edge case: platform doesn't have an extra struct for this capability
            // In this case, required extra should be skipped
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", { required: true })
                    ]),
                    // Add an extra with different capability - should not match
                    unrelated_extra: make_struct_with_capability("platform/i2c_extra.yaml", "i2c_extra", "i2c", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('platform_ops allowed restriction', () => {
        test('ops in allowed list passes', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", {
                            value: "spi_ops_a",
                            allowed: ["platform/spi_ops_a.yaml", "platform/spi_ops_b.yaml"]
                        })
                    ])
                },
                {
                    spi_ops_a: make_platform_ops("platform/spi_ops_a.yaml", "spi_ops_a", "spi"),
                    spi_ops_b: make_platform_ops("platform/spi_ops_b.yaml", "spi_ops_b", "spi")
                }
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('ops not in allowed list fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", {
                            value: "spi_ops_c",
                            allowed: ["platform/spi_ops_a.yaml", "platform/spi_ops_b.yaml"]
                        })
                    ])
                },
                {
                    spi_ops_a: make_platform_ops("platform/spi_ops_a.yaml", "spi_ops_a", "spi"),
                    spi_ops_b: make_platform_ops("platform/spi_ops_b.yaml", "spi_ops_b", "spi"),
                    spi_ops_c: make_platform_ops("platform/spi_ops_c.yaml", "spi_ops_c", "spi")
                }
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not in the allowed list");
        });

        test('allowed overrides capability check - mismatch is warning not error', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_ops_property("platform_ops", {
                            value: "gpio_ops",
                            allowed: ["platform/gpio_ops.yaml"]  // override allows gpio ops for spi
                        })
                    ])
                },
                {
                    gpio_ops: make_platform_ops("platform/gpio_ops.yaml", "gpio_ops", "gpio")
                }
            );
            const result = validate_workfile(workfile);
            // Should be valid (allowed takes precedence) but with warning
            expect(result.valid).toBe(true);
            expect(result.errors.some(_error => _error.severity === "warning" && _error.message.includes("Capability mismatch"))).toBe(true);
        });
    });

    describe('platform_extra allowed restriction', () => {
        test('extra in allowed list passes', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", {
                            value: "my_extra",
                            allowed: ["platform/extra_a.yaml", "platform/extra_b.yaml"]
                        })
                    ]),
                    my_extra: make_struct_with_capability("platform/extra_a.yaml", "extra_a", "spi", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('extra not in allowed list fails', () => {
            const workfile = make_workfile(
                {
                    my_spi: make_struct_with_capability("no-os/spi.yaml", "spi_init", "spi", [
                        make_platform_extra_property("extra", {
                            value: "my_extra",
                            allowed: ["platform/extra_a.yaml", "platform/extra_b.yaml"]
                        })
                    ]),
                    my_extra: make_struct_with_capability("platform/extra_c.yaml", "extra_c", "spi", [])
                },
                {}
            );
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not in the allowed list");
        });
    });

    describe('include_descriptor property validation', () => {
        test('valid include_descriptor passes', () => {
            const parent_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", []);
            parent_spi.$descriptor = "no_os_spi_desc";
            parent_spi.$descriptor_name = "parent_spi_desc";

            const child_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { value: "parent_spi_desc" })
            ]);
            child_spi.$descriptor = "no_os_spi_desc";
            child_spi.$descriptor_name = "child_spi_desc";

            const workfile = make_workfile({
                parent_spi,
                child_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('include_descriptor with missing descriptor fails', () => {
            const child_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { value: "nonexistent_desc" })
            ]);
            child_spi.$descriptor = "no_os_spi_desc";
            child_spi.$descriptor_name = "child_spi_desc";

            const workfile = make_workfile({
                child_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not found");
        });

        test('include_descriptor with type mismatch fails', () => {
            const my_i2c = make_struct("no-os/i2c/no_os_i2c_init_param.yaml", "i2c_init_param", []);
            my_i2c.$descriptor = "no_os_i2c_desc";
            my_i2c.$descriptor_name = "my_i2c_desc";

            const my_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { value: "my_i2c_desc" })
            ]);
            my_spi.$descriptor = "no_os_spi_desc";
            my_spi.$descriptor_name = "my_spi_desc";

            const workfile = make_workfile({
                my_i2c,
                my_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Type mismatch");
        });

        test('include_descriptor without value passes when not required', () => {
            const my_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { required: false })
            ]);
            my_spi.$descriptor = "no_os_spi_desc";
            my_spi.$descriptor_name = "my_spi_desc";

            const workfile = make_workfile({
                my_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('include_descriptor without value fails when required', () => {
            const my_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { required: true })
            ]);
            my_spi.$descriptor = "no_os_spi_desc";
            my_spi.$descriptor_name = "my_spi_desc";

            const workfile = make_workfile({
                my_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("Required property has no value");
        });

        test('include_descriptor with auto-generated descriptor name passes', () => {
            // When $descriptor_name is not set, it defaults to <symbol_name>_desc
            const parent_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", []);
            parent_spi.$descriptor = "no_os_spi_desc";
            // Not setting $descriptor_name, so it should default to "parent_spi_desc"

            const child_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { value: "parent_spi_desc" })
            ]);
            child_spi.$descriptor = "no_os_spi_desc";
            child_spi.$descriptor_name = "child_spi_desc";

            const workfile = make_workfile({
                parent_spi,
                child_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(true);
        });

        test('symbol referencing its own descriptor fails (self-reference)', () => {
            // A symbol whose parent points at its own descriptor forms a self-loop.
            const my_spi = make_struct("no-os/spi/no_os_spi_init_param.yaml", "spi_init_param", [
                make_include_descriptor("parent", "no-os/spi/no_os_spi_init_param.yaml", { value: "my_spi_desc" })
            ]);
            my_spi.$descriptor = "no_os_spi_desc";
            my_spi.$descriptor_name = "my_spi_desc";

            const workfile = make_workfile({
                my_spi
            });
            const result = validate_workfile(workfile);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.message.includes("references itself"))).toBe(true);
        });
    });
});
