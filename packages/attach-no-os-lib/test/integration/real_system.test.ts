import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { WorkfileHandler } from '../../src/workfile_handler/workfile_handler';
import { scan_platform } from '../../src/context_handler/platform_scanner';
import { validate_workfile } from '../../src/validator/validator';
import { RulesetStruct } from '../../src/ruleset_parser/types';
import { expectOk } from '../test_utilities';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { set_schemas_path, reset_settings } from '../../src/settings/settings';

const SCHEMAS_ROOT = path.join(__dirname, '../bindings/schemas');
const PLATFORMS_ROOT = path.join(SCHEMAS_ROOT, 'platforms');

/**
 * Mock for the device suggestion function.
 * In the real app, this would scan device bindings and return available devices.
 * For now, returns a hardcoded list of device binding paths.
 */
function mock_suggest_devices(): string[] {
    return [
        "devices/adxl355/adxl355.yaml",
        "devices/ad7124/ad7124.yaml",
        "devices/adt7420/adt7420.yaml",
    ];
}

describe('Real System Integration', () => {
    let handler: WorkfileHandler;

    beforeEach(() => {
        set_schemas_path(SCHEMAS_ROOT);
        handler = new WorkfileHandler();
    });

    afterEach(() => {
        reset_settings();
    });

    describe('ADXL355 on MAX32690 via SPI', () => {
        test('full setup flow: platform → device → spi → ops/extra → validate', () => {
            // Step 1: User selects MAX32690 platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'maxim/max32690'));
            expectOk(scan_result);

            // Step 2: Load platform into workfile (populates platform_ops)
            const load_result = handler.load_platform(scan_result.value);
            expectOk(load_result);

            // Verify platform ops are available
            const ops_list = handler.list_platform_ops();
            expect(ops_list).toContain('max_spi_ops');
            expect(ops_list).toContain('max_i2c_ops');

            // Verify available structs are returned
            expect(load_result.value.available_structs).toContain('platforms/maxim/max32690/max_spi_init_param.yaml');

            // Step 3: User sees available devices (mocked suggestion function)
            const available_devices = mock_suggest_devices();
            expect(available_devices).toContain("devices/adxl355/adxl355.yaml");

            // Step 4: User selects ADXL355 - load from real binding file
            const adxl355_result = load_resolved_ruleset("devices/adxl355/adxl355.yaml");
            expectOk(adxl355_result);
            const adxl355 = adxl355_result.value as RulesetStruct;
            expect(adxl355.$symbol).toBe("adxl355_init_param");

            const add_device_result = handler.add_symbol("my_adxl355", adxl355);
            expectOk(add_device_result);

            // Step 5: ADXL355 needs SPI - load the no-os SPI struct
            const spi_binding_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
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
            // NOTE: This is just because the toBeDefined doesn't actually narrow the object
            if (!spi_ops) {
                return;
            }
            expect(spi_ops?._t).toBe("RulesetPlatformOps");
            if (spi_ops._t !== "RulesetPlatformOps") {
                return;
            }
            expect(spi_ops?.$capability).toBe("spi");

            handler.set_value("adxl355_spi", "platform_ops", "max_spi_ops");

            // Step 8: Create platform extra struct for SPI
            const extra_binding_result = load_resolved_ruleset("platforms/maxim/max32690/max_spi_init_param.yaml");
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
            handler.load_platform(scan_result.value);

            // Add SPI struct
            const spi_binding_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
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
            handler.load_platform(scan_result.value);

            // Add SPI struct
            const spi_binding_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_binding_result);
            handler.add_symbol("my_spi", spi_binding_result.value as RulesetStruct);

            // Set correct ops
            handler.set_value("my_spi", "platform_ops", "max_spi_ops");

            // Add I2C extra struct (wrong capability for SPI)
            const index2c_extra_result = load_resolved_ruleset("platforms/maxim/max32690/max_i2c_init_param.yaml");
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
            handler.load_platform(scan_result.value);

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

    describe('Xilinx SPI with allowed override', () => {
        test('SPI_ENGINE type restricts ops to spi_engine_ops only', () => {
            // Setup Xilinx platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'xilinx'));
            expectOk(scan_result);
            handler.load_platform(scan_result.value);

            // Verify we have multiple SPI ops
            expect(handler.list_platform_ops()).toContain('xil_spi_ops');
            expect(handler.list_platform_ops()).toContain('xil_spi_pl_ops');
            expect(handler.list_platform_ops()).toContain('spi_eng_platform_ops');

            // Add no-os SPI struct (resolved)
            const spi_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_result);
            handler.add_symbol("my_spi", spi_result.value as RulesetStruct);

            // Set required SPI fields
            handler.set_value("my_spi", "device_id", 0);
            handler.set_value("my_spi", "chip_select", 0);

            // Add Xilinx extra with type = SPI_ENGINE (resolved - type is now EnumProperty)
            const extra_result = load_resolved_ruleset("platforms/xilinx/xil_spi_init_param.yaml");
            expectOk(extra_result);
            handler.add_symbol("my_xil_extra", extra_result.value as RulesetStruct);
            handler.set_value("my_xil_extra", "type", "SPI_ENGINE");

            // Link extra to parent
            handler.set_value("my_spi", "extra", "my_xil_extra");

            // Try to use xil_spi_ops (should fail - not in allowed list for SPI_ENGINE)
            handler.set_value("my_spi", "platform_ops", "xil_spi_ops");

            let validation = validate_workfile(handler.export_workfile());
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(error => error.message.includes("not in the allowed list"))).toBe(true);

            // Use spi_eng_platform_ops (should pass)
            handler.set_value("my_spi", "platform_ops", "spi_eng_platform_ops");

            validation = validate_workfile(handler.export_workfile());
            expect(validation.valid).toBe(true);
        });

        test('SPI_PL type allows both spi_ops and spi_pl_ops', () => {
            // Setup Xilinx platform
            const scan_result = scan_platform(path.join(PLATFORMS_ROOT, 'xilinx'));
            expectOk(scan_result);
            handler.load_platform(scan_result.value);

            // Add no-os SPI struct (resolved)
            const spi_result = load_resolved_ruleset("no-os/no_os_spi_init_param.yaml");
            expectOk(spi_result);
            handler.add_symbol("my_spi", spi_result.value as RulesetStruct);

            // Set required SPI fields
            handler.set_value("my_spi", "device_id", 0);
            handler.set_value("my_spi", "chip_select", 0);

            // Add Xilinx extra with type = SPI_PL (resolved)
            const extra_result = load_resolved_ruleset("platforms/xilinx/xil_spi_init_param.yaml");
            expectOk(extra_result);
            handler.add_symbol("my_xil_extra", extra_result.value as RulesetStruct);
            handler.set_value("my_xil_extra", "type", "SPI_PL");

            // Link extra to parent
            handler.set_value("my_spi", "extra", "my_xil_extra");

            // xil_spi_ops should work
            handler.set_value("my_spi", "platform_ops", "xil_spi_ops");
            let validation = validate_workfile(handler.export_workfile());
            expect(validation.valid).toBe(true);

            // xil_spi_pl_ops should also work
            handler.set_value("my_spi", "platform_ops", "xil_spi_pl_ops");
            validation = validate_workfile(handler.export_workfile());
            expect(validation.valid).toBe(true);

            // spi_eng_platform_ops should fail
            handler.set_value("my_spi", "platform_ops", "spi_eng_platform_ops");
            validation = validate_workfile(handler.export_workfile());
            expect(validation.valid).toBe(false);
            expect(validation.errors.some(error => error.message.includes("not in the allowed list"))).toBe(true);
        });
    });
});
