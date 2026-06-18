import { describe, test, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { ContextHandler } from '../../src/context_handler/context_handler';
import { PlatformCapabilities } from '../../src/context_handler/types';
import { scan_platform } from '../../src/context_handler/platform_scanner';
import expected_max32690_context from './fixtures/expected_max32690_context.json';

describe('ContextHandler', () => {
	let handler: ContextHandler;

	beforeEach(() => {
		handler = new ContextHandler();
	});

	describe('create_context', () => {
		test('creates empty context', () => {
			const context = handler.create_context();
			expect(context.selected_platform).toBeUndefined();
			expect(context.symbols).toEqual([]);
			expect(context.platform_specs).toEqual({});
		});
	});

	describe('get_context', () => {
		test('returns current context', () => {
			const context = handler.get_context();
			expect(context.selected_platform).toBeUndefined();
			expect(context.symbols).toEqual([]);
		});
	});

	describe('platform operations', () => {
		const max32690_capabilities: PlatformCapabilities = {
			spi: { ops: 'spi_ops.yaml', extra: 'max_spi_extra.yaml' },
			i2c: { ops: 'i2c_ops.yaml' },
			gpio: { ops: 'gpio_ops.yaml', extra: 'max_gpio_extra.yaml' },
		};

		beforeEach(() => {
			handler.set_platform_specifications('max32690', max32690_capabilities);
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
			test('returns null when no platform selected', () => {
				expect(handler.get_selected_platform()).toBeUndefined();
			});

			test('returns selected platform', () => {
				handler.set_platform('max32690');
				expect(handler.get_selected_platform()).toBe('max32690');
			});
		});

		describe('has_capability', () => {
			test('returns false when no platform selected', () => {
				expect(handler.has_capability('spi')).toBe(false);
			});

			test('returns true for supported capability', () => {
				handler.set_platform('max32690');
				expect(handler.has_capability('spi')).toBe(true);
				expect(handler.has_capability('i2c')).toBe(true);
			});

			test('returns false for unsupported capability', () => {
				handler.set_platform('max32690');
				expect(handler.has_capability('dma')).toBe(false);
				expect(handler.has_capability('uart')).toBe(false);
			});
		});

		describe('get_capability_specification', () => {
			test('returns undefined when no platform selected', () => {
				expect(handler.get_capability_specification('spi')).toBeUndefined();
			});

			test('returns specification for supported capability', () => {
				handler.set_platform('max32690');
				const spec = handler.get_capability_specification('spi');
				expect(spec).toEqual({ ops: 'spi_ops.yaml', extra: 'max_spi_extra.yaml' });
			});

			test('returns undefined for unsupported capability', () => {
				handler.set_platform('max32690');
				expect(handler.get_capability_specification('dma')).toBeUndefined();
			});
		});

		describe('get_capabilities', () => {
			test('returns empty array when no platform selected', () => {
				expect(handler.get_capabilities()).toEqual([]);
			});

			test('returns all capabilities for selected platform', () => {
				handler.set_platform('max32690');
				const capabilities = handler.get_capabilities();
				expect(capabilities).toContain('spi');
				expect(capabilities).toContain('i2c');
				expect(capabilities).toContain('gpio');
				expect(capabilities).toHaveLength(3);
			});
		});
	});

	describe('platform specs management', () => {
		test('set_platform_specifications registers platform', () => {
			handler.set_platform_specifications('test_platform', { spi: { ops: 'spi.yaml' } });
			expect(handler.get_available_platforms()).toContain('test_platform');
		});

		test('get_platform_specifications returns capabilities', () => {
			const capabilities: PlatformCapabilities = { i2c: { ops: 'i2c.yaml' } };
			handler.set_platform_specifications('test_platform', capabilities);
			expect(handler.get_platform_specifications('test_platform')).toEqual(capabilities);
		});

		test('get_platform_specifications returns undefined for unknown platform', () => {
			expect(handler.get_platform_specifications('unknown')).toBeUndefined();
		});

		test('get_available_platforms returns all registered platforms', () => {
			handler.set_platform_specifications('platform_a', { spi: {} });
			handler.set_platform_specifications('platform_b', { i2c: {} });
			const platforms = handler.get_available_platforms();
			expect(platforms).toContain('platform_a');
			expect(platforms).toContain('platform_b');
			expect(platforms).toHaveLength(2);
		});
	});

	describe('symbol CRUD', () => {
		describe('add_symbol', () => {
			test('adds symbol successfully', () => {
				const result = handler.add_symbol('no_os_spi_init_param', 'spi_ip');
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.value.type).toBe('no_os_spi_init_param');
					expect(result.value.symbol).toBe('spi_ip');
				}
			});

			test('adds symbol with capabilities', () => {
				const result = handler.add_symbol('no_os_spi_init_param', 'spi_ip', ['spi']);
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.value.capabilities).toEqual(['spi']);
				}
			});

			test('rejects duplicate symbol name', () => {
				handler.add_symbol('type_a', 'my_symbol');
				const result = handler.add_symbol('type_b', 'my_symbol');
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.error.message).toContain('already exists');
				}
			});
		});

		describe('remove_symbol', () => {
			test('removes existing symbol', () => {
				handler.add_symbol('type', 'my_symbol');
				const result = handler.remove_symbol('my_symbol');
				expect(result.ok).toBe(true);
				expect(handler.has_symbol('my_symbol')).toBe(false);
			});

			test('rejects removing non-existent symbol', () => {
				const result = handler.remove_symbol('non_existent');
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.error.message).toContain('not found');
				}
			});
		});

		describe('get_symbols', () => {
			test('returns empty array initially', () => {
				expect(handler.get_symbols()).toEqual([]);
			});

			test('returns all symbols', () => {
				handler.add_symbol('type_a', 'symbol_1');
				handler.add_symbol('type_b', 'symbol_2');
				const symbols = handler.get_symbols();
				expect(symbols).toHaveLength(2);
			});
		});

		describe('get_symbols_by_type', () => {
			test('returns symbols of specified type', () => {
				handler.add_symbol('spi_param', 'spi_1');
				handler.add_symbol('spi_param', 'spi_2');
				handler.add_symbol('i2c_param', 'i2c_1');
				const spi_symbols = handler.get_symbols_by_type('spi_param');
				expect(spi_symbols).toHaveLength(2);
				expect(spi_symbols.every(s => s.type === 'spi_param')).toBe(true);
			});

			test('returns empty array for unknown type', () => {
				handler.add_symbol('spi_param', 'spi_1');
				expect(handler.get_symbols_by_type('unknown_type')).toEqual([]);
			});
		});

		describe('has_symbol', () => {
			test('returns true for existing symbol', () => {
				handler.add_symbol('type', 'my_symbol');
				expect(handler.has_symbol('my_symbol')).toBe(true);
			});

			test('returns false for non-existent symbol', () => {
				expect(handler.has_symbol('non_existent')).toBe(false);
			});
		});

		describe('rename_symbol', () => {
			test('renames symbol successfully', () => {
				handler.add_symbol('type', 'old_name');
				const result = handler.rename_symbol('old_name', 'new_name');
				expect(result.ok).toBe(true);
				expect(handler.has_symbol('old_name')).toBe(false);
				expect(handler.has_symbol('new_name')).toBe(true);
			});

			test('rejects renaming non-existent symbol', () => {
				const result = handler.rename_symbol('non_existent', 'new_name');
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.error.message).toContain('not found');
				}
			});

			test('rejects renaming to existing symbol name', () => {
				handler.add_symbol('type', 'symbol_a');
				handler.add_symbol('type', 'symbol_b');
				const result = handler.rename_symbol('symbol_a', 'symbol_b');
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.error.message).toContain('already exists');
				}
			});
		});
	});

	describe('persistence', () => {
		test('load_context replaces current context', () => {
			handler.add_symbol('type', 'original_symbol');
			handler.load_context({
				selected_platform: 'loaded_platform',
				symbols: [{ type: 'loaded_type', symbol: 'loaded_symbol' }],
				platform_specs: { loaded_platform: { spi: {} } },
			});
			expect(handler.get_selected_platform()).toBe('loaded_platform');
			expect(handler.get_symbols()).toHaveLength(1);
			expect(handler.get_symbols()[0].symbol).toBe('loaded_symbol');
		});

		test('export_context returns deep copy', () => {
			handler.add_symbol('type', 'my_symbol');
			const exported = handler.export_context();
			exported.symbols.push({ type: 'new_type', symbol: 'new_symbol' });
			expect(handler.get_symbols()).toHaveLength(1);
		});
	});

	describe('integration', () => {
		test('creates full initial context for max32690', () => {
			const platforms_root = path.join(__dirname, '../bindings/schemas/platforms');
			const platform_path = path.join(platforms_root, 'maxim/max32690');

			const scan_result = scan_platform(platform_path);
			expect(scan_result.ok).toBe(true);
			if (!scan_result.ok) {return;}

			// NOTE: Normally we would do this for all platform before the user sets
			// a specific platform
			handler.set_platform_specifications('max32690', scan_result.value);
			handler.set_platform('max32690');

			const context = handler.export_context();
			expect(context).toEqual(expected_max32690_context);
		});
	});
});
