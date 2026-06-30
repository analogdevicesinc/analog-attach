import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { PlatformOpsProperty } from '../../src/ruleset_parser/types';

describe('PlatformOpsProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_ops', () => {
			const result = loadAndParseProperty('properties/platform_ops/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformOpsProperty');
			const property = result.value as PlatformOpsProperty;
			expect(property.target).toBe('spi_ops');
			expect(property.capability).toEqual(['spi']);
		});
	});

	describe('error cases', () => {
		test('rejects missing target', () => {
			const result = loadAndParseProperty('properties/platform_ops/missing_target.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'target'");
		});
	});
});
