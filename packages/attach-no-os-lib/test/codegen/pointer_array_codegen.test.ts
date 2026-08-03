import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

// An array of POINTER includes is a pointer-to-pointer in C, not an array. no-OS
// declares the i3c bus member as
//
//     const struct no_os_i3c_init_param **devs;
//
// so `.devs = { &eeprom_i3c_ip }` does not compile — braces initialize an array and
// this member is a single pointer. Codegen must hoist a real file-scope array that
// decays to that pointer:
//
//     const struct no_os_i3c_init_param *i3c1_ip_devs[] = { &eeprom_i3c_ip };
//     ... .devs = i3c1_ip_devs,
//
// Arrays of EMBEDDED includes (ad7124 `setups`) are genuine C arrays and must keep
// their inline braces, so both shapes are pinned here.
const NOOS_ROOT = path.join(__dirname, '../bindings');

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
            "num_devs": 2,
            "devs": ["eeprom_i3c_ip", "sensor_i3c_ip"],
            "extra": "stm32_i3c_ip"
        },
        "eeprom_i3c_ip": {
            "$compatible": "no-os/i3c/no_os_i3c_init_param.yaml",
            "bus": "i3c1_ip",
            "pid": 0,
            "addr": 42,
            "is_i3c": true
        },
        "sensor_i3c_ip": {
            "$compatible": "no-os/i3c/no_os_i3c_init_param.yaml",
            "bus": "i3c1_ip",
            "pid": 1,
            "addr": 43,
            "is_i3c": true
        },
        "i3c1": {
            "$compatible": "no-os/i3c_bus/no_os_i3c_bus.yaml",
            "init_param": "i3c1_ip"
        }
    }
};

function generate(workfile: MinimalWorkfile, output_path: string, project_name: string): string {
    const import_result = import_minimal(workfile);
    expectOk(import_result);

    const result = generate_project({
        workfile: import_result.value,
        platform_name: "stm32",
        platform_vendor: "stm32",
        project_name: project_name,
        output_path: output_path,
        noos_path: "../..",
    });
    expectOk(result);

    return fs.readFileSync(
        path.join(output_path, project_name, 'src/common/common_data.c'), 'utf8'
    );
}

describe('pointer array codegen', () => {
    let temporary_directory: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-array-test-'));
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    // The core of the fix: a named array, typed from the referenced symbols, holding
    // the addresses in workfile order.
    test('hoists a named array for an array of pointer includes', () => {
        const common_data = generate(i3c_workfile, temporary_directory, 'ptr_array');

        expect(common_data).toContain(
            'const struct no_os_i3c_init_param *i3c1_ip_devs[] = { &eeprom_i3c_ip, &sensor_i3c_ip };'
        );
        expect(common_data).toContain('.devs = i3c1_ip_devs,');
    });

    // The member takes the array's NAME, never a braced list — that was the compile error.
    test('the member never gets an inline braced list', () => {
        const common_data = generate(i3c_workfile, temporary_directory, 'ptr_array');

        expect(common_data).not.toContain('.devs = {');
    });

    // The array must be DEFINED before the struct that points at it: unlike a pointer
    // to a struct, an array name used in a const initializer needs its definition in
    // scope, and common_data.h emits no extern for generated arrays.
    test('the array is emitted above the struct that uses it', () => {
        const common_data = generate(i3c_workfile, temporary_directory, 'ptr_array');

        const array_at = common_data.indexOf('*i3c1_ip_devs[]');
        const struct_at = common_data.indexOf('no_os_i3c_bus_init_param i3c1_ip = {');
        expect(array_at).toBeGreaterThanOrEqual(0);
        expect(struct_at).toBeGreaterThan(array_at);
    });

    // Nothing declares a generated array in the header; it is referenced only by the
    // struct directly beneath it, so an extern would be dead (and a name we do not own).
    test('the array gets no extern in common_data.h', () => {
        generate(i3c_workfile, temporary_directory, 'ptr_array');

        const header = fs.readFileSync(
            path.join(temporary_directory, 'ptr_array/src/common/common_data.h'), 'utf8'
        );
        expect(header).not.toContain('i3c1_ip_devs');
    });

    // An empty pointer array has no array object to decay, so the member is NULL —
    // `{ 0 }` would be an array initializer for a plain pointer member.
    test('an empty pointer array becomes NULL, not { 0 }', () => {
        const empty: MinimalWorkfile = structuredClone(i3c_workfile);
        empty.symbols["i3c1_ip"]["devs"] = [];
        empty.symbols["i3c1_ip"]["num_devs"] = 0;
        delete empty.symbols["eeprom_i3c_ip"];
        delete empty.symbols["sensor_i3c_ip"];

        const common_data = generate(empty, temporary_directory, 'empty_ptr_array');

        expect(common_data).toContain('.devs = NULL,');
        expect(common_data).not.toContain('i3c1_ip_devs');
    });

    // The regression guard: arrays of EMBEDDED includes are real C arrays and must
    // still be initialized inline. Only `pointer: true` elements get hoisted.
    test('an array of embedded includes keeps its inline braces', () => {
        const ad7124_workfile: MinimalWorkfile = {
            platform: "stm32",
            symbols: {
                "max_spi_ip": {
                    "$compatible": "platforms/stm32/stm32_spi_init_param.yaml",
                    "chip_select_port": 0
                },
                "spi_ip": {
                    "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
                    "device_id": 0,
                    "max_speed_hz": 1000000,
                    "chip_select": 0,
                    "mode": "NO_OS_SPI_MODE_0",
                    "platform_ops": "stm32_spi_ops",
                    "extra": "max_spi_ip"
                },
                "setup_a": {
                    "$compatible": "devices/ad7124/structs/ad7124_channel_setup.yaml",
                    "bi_unipolar": true
                },
                "ad7124_ip": {
                    "$compatible": "devices/ad7124/ad7124_init_param.yaml",
                    "spi_init": "spi_ip",
                    "setups": ["setup_a"]
                }
            }
        };

        const common_data = generate(ad7124_workfile, temporary_directory, 'embedded_array');

        expect(common_data).toContain('.setups = { setup_a },');
        expect(common_data).not.toContain('ad7124_ip_setups');
    });
});
