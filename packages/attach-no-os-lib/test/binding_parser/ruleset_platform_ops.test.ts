import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseRuleset } from '../test_utilities';
import { RulesetPlatformOps, RulesetType } from '../../src/ruleset_parser/types';

describe('BindingPlatformOps parsing', () => {
	describe('valid cases', () => {
		test('parses minimal platform_ops binding', () => {
			const result = loadAndParseRuleset('bindings/platform_ops/valid_minimal.yaml');
			expectOk(result);
			expect(result.value._t).toBe('RulesetPlatformOps');
			expect(result.value.$type).toBe(RulesetType.RT_PLATFORM_OPS);
			expect(result.value.$symbol).toBe('spi_ops');
		});

		test('parses $capability field', () => {
			const result = loadAndParseRuleset('bindings/platform_ops/valid_with_capability.yaml');
			expectOk(result);
			const binding = result.value as RulesetPlatformOps;
			expect(binding.$capability).toBe('spi');
		});

		test('$capability is undefined when not specified', () => {
			const result = loadAndParseRuleset('bindings/platform_ops/valid_minimal.yaml');
			expectOk(result);
			const binding = result.value as RulesetPlatformOps;
			expect(binding.$capability).toBeUndefined();
		});
	});
});
