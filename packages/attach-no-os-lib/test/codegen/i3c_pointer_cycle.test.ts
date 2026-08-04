import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { topo_sorted_symbols } from '../../src/validator/connection_graph';
import { validate_workfile } from '../../src/validator/validator';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

// i3c is the first model with a genuine two-node reference cycle:
//
//     i3c1_ip (bus) --devs[]--> eeprom_i3c_ip (device)
//     eeprom_i3c_ip --bus-----> i3c1_ip
//
// Both edges are `pointer: true` in the schemas, matching the real C
// (`const struct no_os_i3c_init_param **devs` / `struct no_os_i3c_bus_init_param *bus`),
// so the cycle is legal C: a pointer only needs a declaration, not a prior definition.
// The topo sort currently treats every reference as a hard declare-before edge and
// throws, which blocks codegen for any valid i3c workfile.
const NOOS_ROOT = path.join(__dirname, '../bindings');

// One bus + one device on it, plus the bus descriptor that drives no_os_i3c_init_bus.
// `devs` holds the device and the device's `bus` points back at the bus: the cycle.
const i3c_workfile: MinimalWorkfile = {
    platform: "stm32",
    symbols: {
        "stm32_i3c_ip": {
            "$compatible": "platforms/stm32/stm32_i3c_init_param.yaml",
            "hi3c": "&hi3c1",
            "irq_id": 0
        },
        "i3c1_ip": {
            "$compatible": "no-os/i3c_bus/no_os_i3c_bus_init_param.yaml",
            "device_id": 1,
            "platform_ops": "stm32_i3c_ops",
            "num_devs": 1,
            "devs": ["eeprom_i3c_ip"],
            "extra": "stm32_i3c_ip"
        },
        "eeprom_i3c_ip": {
            "$compatible": "no-os/i3c/no_os_i3c_init_param.yaml",
            "bus": "i3c1_ip",
            "pid": 0,
            "addr": 42,
            "is_i3c": true
        },
        "i3c1": {
            "$compatible": "no-os/i3c_bus/no_os_i3c_bus.yaml",
            "init_param": "i3c1_ip"
        }
    }
};

describe('i3c pointer cycle', () => {
    let temporary_directory: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'i3c-cycle-test-'));
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    // The workfile itself is well-formed: every reference resolves, nothing is missing.
    // Only the ORDERING step rejects it, which is what makes this a codegen bug rather
    // than a bad workfile. Guards against "fixing" this by making the workfile invalid.
    test('an i3c bus + device workfile is valid', () => {
        const import_result = import_minimal(i3c_workfile);
        expectOk(import_result);

        const validation = validate_workfile(import_result.value);
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    // Every symbol must appear exactly once, with the two pointer-linked symbols in
    // SOME order — a pointer cycle has no dependency-first order, and does not need one.
    test('topo sort orders a pointer cycle instead of reporting one', () => {
        const import_result = import_minimal(i3c_workfile);
        expectOk(import_result);

        const { order, cycles } = topo_sorted_symbols(import_result.value);

        expect(cycles).toEqual([]);
        expect([...order].sort()).toEqual(
            Object.keys(i3c_workfile.symbols).sort()
        );
    });

    // Same graph shape as i3c, but with both edges demoted to VALUE edges: each struct
    // would have to be defined before the other, which no ordering satisfies.
    function value_cycle_workfile() {
        const import_result = import_minimal(i3c_workfile);
        expectOk(import_result);
        const workfile = import_result.value;

        const bus = workfile.symbols["i3c1_ip"];
        const device = workfile.symbols["eeprom_i3c_ip"];
        if (bus._t !== "RulesetStruct" || device._t !== "RulesetStruct") {
            expect.fail("expected i3c bus and device to be struct nodes");
        }

        const devs = bus.properties.find(p => p.name === "devs");
        const bus_reference = device.properties.find(p => p.name === "bus");
        if (devs?._t !== "ArrayProperty" || bus_reference?._t !== "IncludeProperty") {
            expect.fail("expected devs to be an array property and bus an include property");
        }
        if (devs.element._t !== "IncludeProperty") {
            expect.fail("expected devs elements to be include properties");
        }
        devs.element.pointer = false;
        bus_reference.pointer = false;

        return workfile;
    }

    // The guard that breaking pointer edges did not make the sort accept everything: a
    // value cycle is still unorderable and must be reported.
    test('a value cycle is reported by the topo sort', () => {
        const { cycles } = topo_sorted_symbols(value_cycle_workfile());

        expect(cycles).toHaveLength(1);
        expect([...cycles[0]].sort()).toEqual(["eeprom_i3c_ip", "i3c1_ip"]);
    });

    // Innocent symbols left stranded by the stalled sort are covered in
    // test/validator/validator.test.ts ('only depends on a cycle is not blamed'): it
    // cannot be shown here, because a descriptor's `init_param` is `pointer: true` and so
    // never gets stuck behind a cycle in the first place.

    // P4: a value cycle is a workfile defect, so it belongs in the validation result with
    // a path per involved symbol — not a thrown error surfaced as a generic Result later.
    test('a value cycle is a validation error naming every member and the loop', () => {
        const validation = validate_workfile(value_cycle_workfile());

        expect(validation.valid).toBe(false);
        expect([...validation.errors].map(e => e.path).sort())
            .toEqual(["eeprom_i3c_ip", "i3c1_ip"]);
        // The chain is spelled out so the reader can follow it edge by edge.
        for (const error of validation.errors) {
            expect(error.message).toMatch(/i3c1_ip -> eeprom_i3c_ip -> i3c1_ip|eeprom_i3c_ip -> i3c1_ip -> eeprom_i3c_ip/);
        }
    });

    // Codegen runs after validation, so this is a backstop rather than the user-facing
    // path: a partial order must never quietly emit C with structs used before defined.
    test('generation refuses a value cycle instead of emitting a partial order', () => {
        const result = generate_project({
            workfile: value_cycle_workfile(),
            platform_name: "stm32",
            platform_vendor: "stm32",
            project_name: "value_cycle",
            output_path: temporary_directory,
            noos_path: "../..",
        });

        expect(result.ok).toBe(false);
    });

    // End to end: the whole point of the fix. Emitting the project must succeed, and the
    // pointer-linked structs must both land in common_data.c.
    test('generates a project for an i3c bus + device', () => {
        const import_result = import_minimal(i3c_workfile);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "stm32",
            platform_vendor: "stm32",
            project_name: "i3c_cycle",
            output_path: temporary_directory,
            noos_path: "../..",
        });

        expectOk(result);

        const common_data = fs.readFileSync(
            path.join(temporary_directory, 'i3c_cycle/src/common/common_data.c'), 'utf8'
        );
        expect(common_data).toContain('struct no_os_i3c_bus_init_param i3c1_ip');
        expect(common_data).toContain('struct no_os_i3c_init_param eeprom_i3c_ip');
    });
});
