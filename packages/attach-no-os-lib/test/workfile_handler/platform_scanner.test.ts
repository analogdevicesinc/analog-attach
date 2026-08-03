import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { scan_platform, scan_platforms } from '../../src/workfile_handler/platform_scanner';
import { setup_test_config, teardown_test_config } from '../test_utilities';

const NOOS_ROOT = path.join(__dirname, '../bindings');
const SCHEMAS_ROOT = path.join(NOOS_ROOT, 'schemas');
const PLATFORMS_ROOT = path.join(SCHEMAS_ROOT, 'platforms');

// The declared ops/structs for a platform, straight from its platform.yaml. Tests
// assert the scanner reflects the manifest instead of pinning today's contents,
// which would break every time a platform gains an op.
function read_manifest(relative_platform_path: string): { ops: string[], structs: string[] } {
	const manifest_path = path.join(PLATFORMS_ROOT, relative_platform_path, 'platform.yaml');
	const parsed = YAML.parse(fs.readFileSync(manifest_path, 'utf8')) as {
		ops?: string[],
		structs?: string[]
	};
	return { ops: parsed.ops ?? [], structs: parsed.structs ?? [] };
}

describe('platform_scanner', () => {
	beforeEach(() => {
		setup_test_config(NOOS_ROOT);
	});

	afterEach(() => {
		teardown_test_config();
	});

	describe('scan_platform', () => {
		test('scans max32690 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'maxim/max32690');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			// Compared against the manifest rather than a hardcoded count, so adding
			// or removing an op in platform.yaml does not fail a working scanner. What
			// is under test is the prefixing: manifest paths are platform-relative,
			// the scanned ones are schemas-root-relative.
			const manifest = read_manifest('maxim/max32690');
			const prefix = 'platforms/maxim/max32690';

			expect(result.value.ops).toEqual(manifest.ops.map(p => `${prefix}/${p}`));
			expect(result.value.ops).toContain(`${prefix}/platform_ops/spi_ops.yaml`);
			expect(result.value.ops).toContain(`${prefix}/platform_ops/i2c_ops.yaml`);

			expect(result.value.structs).toEqual(manifest.structs.map(p => `${prefix}/${p}`));
			expect(result.value.structs).toContain(`${prefix}/max_spi_init_param.yaml`);
		});

		test('scans xilinx platform with spi variants', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'xilinx');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			// All three spi ops variants
			expect(result.value.ops).toContain('platforms/xilinx/platform_ops/spi_ops.yaml');
			expect(result.value.ops).toContain('platforms/xilinx/platform_ops/spi_engine_ops.yaml');
			expect(result.value.ops).toContain('platforms/xilinx/platform_ops/spi_pl_ops.yaml');

			expect(result.value.structs).toContain('platforms/xilinx/xil_spi_init_param.yaml');
		});

		test('scans stm32 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'stm32');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			expect(result.value.ops).toContain('platforms/stm32/platform_ops/gpio_irq_ops.yaml');
			expect(result.value.ops).toContain('platforms/stm32/platform_ops/dma_ops.yaml');
			expect(result.value.structs).toContain('platforms/stm32/stm32_gpio_irq_init_param.yaml');
			expect(result.value.structs).toContain('platforms/stm32/stm32_dma_init_param.yaml');
		});

		test('rejects non-existent path', () => {
			const result = scan_platform('/non/existent/path');
			expect(result.ok).toBe(false);
			if (result.ok) {return;}
			expect(result.error.message).toContain('does not exist');
		});

		test('rejects path without platform.yaml', () => {
			const result = scan_platform(PLATFORMS_ROOT);
			expect(result.ok).toBe(false);
			if (result.ok) {return;}
			expect(result.error.message).toContain('Missing platform.yaml');
		});
	});

	describe('scan_platforms', () => {
		test('finds all platforms recursively', () => {
			const result = scan_platforms(PLATFORMS_ROOT);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			// Should find all platforms
			expect(Object.keys(result.value)).toContain('max32690');
			expect(Object.keys(result.value)).toContain('xilinx');
			expect(Object.keys(result.value)).toContain('stm32');
			expect(Object.keys(result.value)).toContain('linux');
			expect(Object.keys(result.value)).toContain('pico');
		});

		test('rejects non-existent root', () => {
			const result = scan_platforms('/non/existent/path');
			expect(result.ok).toBe(false);
			if (result.ok) {return;}
			expect(result.error.message).toContain('does not exist');
		});
	});
});
