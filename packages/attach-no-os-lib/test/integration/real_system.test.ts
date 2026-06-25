import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkfileHandler } from '../../src/workfile_handler/workfile_handler';
import { scan_platform } from '../../src/context_handler/platform_scanner';
import { parse_binding } from '../../src/bindings_parser/binding_parser';
import { validate_workfile } from '../../src/validator/validator';
import { BindingLoader } from '../../src/workfile_handler/types';
import { RulesetStruct } from '../../src/bindings_parser/types';
import { expectOk } from '../test_utils';

const SCHEMAS_ROOT = path.join(__dirname, '../bindings/schemas');
const PLATFORMS_ROOT = path.join(SCHEMAS_ROOT, 'platforms');

function create_loader(base_path: string): BindingLoader {
    return (binding_path: string) => {
        const full_path = path.join(base_path, binding_path);
        const contents = fs.readFileSync(full_path, 'utf8');
        return parse_binding(contents);
    };
}

/**
 * Mock for the device suggestion function.
 * In the real app, this would scan device bindings and return available devices.
 * For now, returns a hardcoded list of device binding paths.
 */
function mock_suggest_devices(): string[] {
    return [
        "devices/adi,adxl355.yaml",
        "devices/adi,ad7124.yaml",
        "devices/adi,adt7420.yaml",
    ];
}

describe('Real System Integration', () => {
    let handler: WorkfileHandler;
    let platform_loader: BindingLoader;
    let schemas_loader: BindingLoader;

    beforeEach(() => {
        handler = new WorkfileHandler();
        platform_loader = create_loader(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
        schemas_loader = create_loader(SCHEMAS_ROOT);
    });

    describe('ADXL355 on MAX32690 via SPI', () => {
        test('full setup flow: platform → device → spi → ops/extra → validate', () => {
            // Step 1: User selects MAX32690 platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
            expectOk(scan_result);

            // Step 2: Load platform into workfile (populates platform_ops)
            const load_result = handler.load_platform(scan_result.value, platform_loader);
            expectOk(load_result);

            // Verify platform ops are available
            const ops_list = handler.list_platform_ops();
            expect(ops_list).toContain('max_spi_ops');
            expect(ops_list).toContain('max_i2c_ops');

            // Verify available structs are returned
            expect(load_result.value.available_structs).toContain('max_spi_init_param.yaml');

            // Step 3: User sees available devices (mocked suggestion function)
            const available_devices = mock_suggest_devices();
            expect(available_devices).toContain("devices/adi,adxl355.yaml");

            // Step 4: User selects ADXL355 - load from real binding file
            const adxl355_result = schemas_loader("devices/adi,adxl355.yaml");
            expectOk(adxl355_result);
            const adxl355 = adxl355_result.value as RulesetStruct;
            expect(adxl355.$symbol).toBe("adxl355_init_param");

            const add_device_result = handler.add_symbol("my_adxl355", adxl355);
            expectOk(add_device_result);

            // Step 5: ADXL355 needs SPI - load the no-os SPI struct
            const spi_binding_result = schemas_loader("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_binding_result);
            const spi_struct = spi_binding_result.value as RulesetStruct;

            // Add SPI symbol for the ADXL355
            const add_spi_result = handler.add_symbol("adxl355_spi", spi_struct);
            expectOk(add_spi_result);

            // Step 6: Configure SPI basic properties
            handler.set_value("adxl355_spi", "device_id", 1);
            handler.set_value("adxl355_spi", "chip_select", 0);
            handler.set_value("adxl355_spi", "max_speed_hz", 1_000_000);

            // Step 7: Set platform_ops - user picks from available ops
            // The suggest function would show matching ops by capability
            const spi_ops = handler.find_any("max_spi_ops");
            expect(spi_ops).toBeDefined();
            expect(spi_ops?._t).toBe("BindingPlatformOps");
            expect(spi_ops?.$capability).toBe("spi");

            handler.set_value("adxl355_spi", "platform_ops", "max_spi_ops");

            // Step 8: Create platform extra struct for SPI
            const extra_binding_result = platform_loader("max_spi_init_param.yaml");
            expectOk(extra_binding_result);
            const extra_struct = extra_binding_result.value as RulesetStruct;

            const add_extra_result = handler.add_symbol("adxl355_spi_extra", extra_struct);
            expectOk(add_extra_result);

            // Configure extra properties
            handler.set_value("adxl355_spi_extra", "num_slaves", 1);

            // Step 9: Link SPI extra to the extra struct
            handler.set_value("adxl355_spi", "extra", "adxl355_spi_extra");

            // Step 10: Configure ADXL355 - set comm_type and link to SPI
            handler.set_value("my_adxl355", "comm_type", "ADXL355_SPI_COMM");
            handler.set_value("my_adxl355", "dev_type", "ID_ADXL355");
            // The union member is set via the comm_init property
            handler.set_value("my_adxl355", "comm_init", { spi_init: "adxl355_spi" });

            // Step 11: Validate the complete workfile
            const workfile = handler.export_workfile();
            const validation = validate_workfile(workfile);

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Verify final structure
            expect(handler.list_symbols()).toEqual([
                "my_adxl355",
                "adxl355_spi",
                "adxl355_spi_extra"
            ]);
            expect(handler.list_platform_ops()).toContain("max_spi_ops");
        });

        test('validation fails if platform_ops capability mismatches', () => {
            // Setup platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
            expectOk(scan_result);
            handler.load_platform(scan_result.value, platform_loader);

            // Add SPI struct
            const spi_binding_result = schemas_loader("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_binding_result);
            handler.add_symbol("my_spi", spi_binding_result.value as RulesetStruct);

            // Try to use I2C ops for SPI (wrong capability)
            handler.set_value("my_spi", "platform_ops", "max_i2c_ops");

            // Validation should fail
            const workfile = handler.export_workfile();
            const validation = validate_workfile(workfile);

            expect(validation.valid).toBe(false);
            expect(validation.errors.some(error => error.message.includes("Capability mismatch"))).toBe(true);
        });

        test('validation fails if extra capability mismatches', () => {
            // Setup platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
            expectOk(scan_result);
            handler.load_platform(scan_result.value, platform_loader);

            // Add SPI struct
            const spi_binding_result = schemas_loader("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_binding_result);
            handler.add_symbol("my_spi", spi_binding_result.value as RulesetStruct);

            // Set correct ops
            handler.set_value("my_spi", "platform_ops", "max_spi_ops");

            // Add I2C extra struct (wrong capability for SPI)
            const index2c_extra_result = platform_loader("max_i2c_init_param.yaml");
            expectOk(index2c_extra_result);
            handler.add_symbol("wrong_extra", index2c_extra_result.value as RulesetStruct);

            // Try to use I2C extra for SPI
            handler.set_value("my_spi", "extra", "wrong_extra");

            // Validation should fail
            const workfile = handler.export_workfile();
            const validation = validate_workfile(workfile);

            expect(validation.valid).toBe(false);
            expect(validation.errors.some(error => error.message.includes("Capability mismatch"))).toBe(true);
        });

        test('suggestions show only matching capability ops', () => {
            // Setup platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
            expectOk(scan_result);
            handler.load_platform(scan_result.value, platform_loader);

            // Get all platform ops and check capabilities
            const spi_ops = handler.get_platform_ops("max_spi_ops");
            const index2c_ops = handler.get_platform_ops("max_i2c_ops");
            const gpio_ops = handler.get_platform_ops("max_gpio_ops");

            expectOk(spi_ops);
            expectOk(index2c_ops);
            expectOk(gpio_ops);

            expect(spi_ops.value.$capability).toBe("spi");
            expect(index2c_ops.value.$capability).toBe("i2c");
            expect(gpio_ops.value.$capability).toBe("gpio");

            // A real suggest function would filter by capability
            const all_ops = handler.list_platform_ops();
            const spi_compatible = all_ops.filter(name => {
                const ops = handler.get_platform_ops(name);
                return ops.ok && ops.value.$capability === "spi";
            });

            expect(spi_compatible).toEqual(["max_spi_ops"]);
        });
    });
});
