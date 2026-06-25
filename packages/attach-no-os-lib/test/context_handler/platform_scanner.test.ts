import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { scan_platform, scan_platforms } from '../../src/context_handler/platform_scanner';

const PLATFORMS_ROOT = path.join(__dirname, '../bindings/schemas/platforms');

describe('platform_scanner', () => {
	describe('scan_platform', () => {
		test('scans max32690 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'maxim/max32690');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			expect(result.value.ops).toHaveLength(7);
			expect(result.value.ops).toContain('platform_ops/spi_ops.yaml');
			expect(result.value.ops).toContain('platform_ops/i2c_ops.yaml');

			expect(result.value.structs).toHaveLength(5);
			expect(result.value.structs).toContain('max_spi_init_param.yaml');
		});

		test('scans xilinx platform with spi variants', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'xilinx');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			// All three spi ops variants
			expect(result.value.ops).toContain('platform_ops/spi_ops.yaml');
			expect(result.value.ops).toContain('platform_ops/spi_engine_ops.yaml');
			expect(result.value.ops).toContain('platform_ops/spi_pl_ops.yaml');

			expect(result.value.structs).toContain('xil_spi_init_param.yaml');
		});

		test('scans stm32 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'stm32');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			expect(result.value.ops).toContain('platform_ops/gpio_irq_ops.yaml');
			expect(result.value.ops).toContain('platform_ops/dma_ops.yaml');
			expect(result.value.structs).toContain('stm32_gpio_irq_init_param.yaml');
			expect(result.value.structs).toContain('stm32_dma_init_param.yaml');
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
