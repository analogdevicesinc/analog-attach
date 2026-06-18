import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { scan_platform, scan_platforms } from '../../src/context_handler/platform_scanner';
import expected_max32690 from './fixtures/expected_max32690.json';

const PLATFORMS_ROOT = path.join(__dirname, '../bindings/schemas/platforms');

describe('platform_scanner', () => {
	describe('scan_platform', () => {
		test('scans max32690 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'maxim/max32690');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {
				return;
			}

			expect(result.value).toEqual(expected_max32690);
		});

		test('scans xilinx platform with spi variants', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'xilinx');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			// All three spi variants share the same extra
			expect(result.value.spi).toEqual({
				ops: 'platform_ops/spi_ops.yaml',
				extra: 'xil_spi_init_param.yaml',
			});
			expect(result.value.spi_engine).toEqual({
				ops: 'platform_ops/spi_engine_ops.yaml',
				extra: 'xil_spi_init_param.yaml',
			});
			expect(result.value.spi_pl).toEqual({
				ops: 'platform_ops/spi_pl_ops.yaml',
				extra: 'xil_spi_init_param.yaml',
			});

			// gpio and gpio_irq
			expect(result.value.gpio).toBeDefined();
			expect(result.value.gpio_irq).toBeDefined();
		});

		test('scans stm32 platform', () => {
			const platform_path = path.join(PLATFORMS_ROOT, 'stm32');
			const result = scan_platform(platform_path);

			expect(result.ok).toBe(true);
			if (!result.ok) {return;}

			expect(result.value.gpio_irq).toEqual({
				ops: 'platform_ops/gpio_irq_ops.yaml',
				extra: 'stm32_gpio_irq_init_param.yaml',
			});
			expect(result.value.dma).toEqual({
				ops: 'platform_ops/dma_ops.yaml',
				extra: 'stm32_dma_init_param.yaml',
			});
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
