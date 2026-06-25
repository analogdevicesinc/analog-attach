import { describe, test, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { ContextHandler } from '../../src/context_handler/context_handler';
import { PlatformManifest } from '../../src/context_handler/types';
import { scan_platform } from '../../src/context_handler/platform_scanner';

describe('ContextHandler', () => {
	let handler: ContextHandler;

	beforeEach(() => {
		handler = new ContextHandler();
	});

	describe('create_context', () => {
		test('creates empty context', () => {
			const context = handler.create_context();
			expect(context.selected_platform).toBeUndefined();
			expect(context.platform_specs).toEqual({});
		});
	});

	describe('get_context', () => {
		test('returns current context', () => {
			const context = handler.get_context();
			expect(context.selected_platform).toBeUndefined();
		});
	});

	describe('platform operations', () => {
		const max32690_manifest: PlatformManifest = {
			name: 'max32690',
			ops: ['platform_ops/spi_ops.yaml', 'platform_ops/i2c_ops.yaml'],
			structs: ['max_spi_init_param.yaml', 'max_i2c_init_param.yaml'],
		};

		beforeEach(() => {
			handler.set_platform_specifications('max32690', max32690_manifest);
		});

		describe('set_platform', () => {
			test('sets platform when valid', () => {
				const result = handler.set_platform('max32690');
				expect(result.ok).toBe(true);
				expect(handler.get_selected_platform()).toBe('max32690');
			});

			test('rejects unknown platform', () => {
				const result = handler.set_platform('unknown_platform');
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.error.message).toContain('Unknown platform');
				}
			});
		});

		describe('get_selected_platform', () => {
			test('returns undefined when no platform selected', () => {
				expect(handler.get_selected_platform()).toBeUndefined();
			});

			test('returns selected platform', () => {
				handler.set_platform('max32690');
				expect(handler.get_selected_platform()).toBe('max32690');
			});
		});

		describe('get_platform_manifest', () => {
			test('returns undefined when no platform selected', () => {
				expect(handler.get_platform_manifest()).toBeUndefined();
			});

			test('returns manifest for selected platform', () => {
				handler.set_platform('max32690');
				const manifest = handler.get_platform_manifest();
				expect(manifest).toEqual(max32690_manifest);
			});
		});
	});

	describe('platform specs management', () => {
		test('set_platform_specifications registers platform', () => {
			handler.set_platform_specifications('test_platform', { name: 'test_platform', ops: [], structs: [] });
			expect(handler.get_available_platforms()).toContain('test_platform');
		});

		test('get_platform_specifications returns manifest', () => {
			const manifest: PlatformManifest = { name: 'test_platform', ops: ['spi.yaml'], structs: [] };
			handler.set_platform_specifications('test_platform', manifest);
			expect(handler.get_platform_specifications('test_platform')).toEqual(manifest);
		});

		test('get_platform_specifications returns undefined for unknown platform', () => {
			expect(handler.get_platform_specifications('unknown')).toBeUndefined();
		});

		test('get_available_platforms returns all registered platforms', () => {
			handler.set_platform_specifications('platform_a', { name: 'platform_a', ops: [], structs: [] });
			handler.set_platform_specifications('platform_b', { name: 'platform_b', ops: [], structs: [] });
			const platforms = handler.get_available_platforms();
			expect(platforms).toContain('platform_a');
			expect(platforms).toContain('platform_b');
			expect(platforms).toHaveLength(2);
		});
	});

	describe('persistence', () => {
		test('load_context replaces current context', () => {
			handler.set_platform_specifications('original', { name: 'original', ops: [], structs: [] });
			handler.load_context({
				selected_platform: 'loaded_platform',
				platform_specs: { loaded_platform: { name: 'loaded_platform', ops: ['spi.yaml'], structs: [] } },
			});
			expect(handler.get_selected_platform()).toBe('loaded_platform');
			expect(handler.get_available_platforms()).toEqual(['loaded_platform']);
		});

		test('export_context returns deep copy', () => {
			handler.set_platform_specifications('test', { name: 'test', ops: [], structs: [] });
			const exported = handler.export_context();
			exported.platform_specs['test'].ops.push('new.yaml');
			expect(handler.get_platform_specifications('test')?.ops).toEqual([]);
		});
	});

	describe('integration', () => {
		test('scans and loads max32690 platform', () => {
			const platforms_root = path.join(__dirname, '../bindings/schemas/platforms');
			const platform_path = path.join(platforms_root, 'maxim/max32690');

			const scan_result = scan_platform(platform_path);
			expect(scan_result.ok).toBe(true);
			if (!scan_result.ok) {return;}

			handler.set_platform_specifications('max32690', scan_result.value);
			handler.set_platform('max32690');

			const manifest = handler.get_platform_manifest();
			expect(manifest).toBeDefined();
			expect(manifest?.ops).toHaveLength(7);
			expect(manifest?.structs).toHaveLength(5);
		});
	});
});
