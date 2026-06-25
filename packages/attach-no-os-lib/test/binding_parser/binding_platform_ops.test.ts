import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseBinding } from '../test_utils';
import { RulesetPlatformOps, RulesetType } from '../../src/bindings_parser/types';

describe('BindingPlatformOps parsing', () => {
	describe('valid cases', () => {
		test('parses minimal platform_ops binding', () => {
			const result = loadAndParseBinding('bindings/platform_ops/valid_minimal.yaml');
			expectOk(result);
			expect(result.value._t).toBe('BindingPlatformOps');
			expect(result.value.$type).toBe(RulesetType.BT_PLATFORM_OPS);
			expect(result.value.$symbol).toBe('spi_ops');
		});

		test('parses $capability field', () => {
			const result = loadAndParseBinding('bindings/platform_ops/valid_with_capability.yaml');
			expectOk(result);
			const binding = result.value as RulesetPlatformOps;
			expect(binding.$capability).toBe('spi');
		});

		test('$capability is undefined when not specified', () => {
			const result = loadAndParseBinding('bindings/platform_ops/valid_minimal.yaml');
			expectOk(result);
			const binding = result.value as RulesetPlatformOps;
			expect(binding.$capability).toBeUndefined();
		});
	});
});
