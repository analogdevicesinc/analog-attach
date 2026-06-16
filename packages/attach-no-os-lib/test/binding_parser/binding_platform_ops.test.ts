import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseBinding } from '../test_utils';
import { BindingType } from '../../src/bindings_parser/types';

describe('BindingPlatformOps parsing', () => {
	describe('valid cases', () => {
		test('parses minimal platform_ops binding', () => {
			const result = loadAndParseBinding('bindings/platform_ops/valid_minimal.yaml');
			expectOk(result);
			expect(result.value._t).toBe('BindingPlatformOps');
			expect(result.value.$type).toBe(BindingType.BT_PLATFORM_OPS);
			expect(result.value.$name).toBe('spi_ops');
		});
	});
});
