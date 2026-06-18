import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { PlatformOpsProperty } from '../../src/bindings_parser/types';

describe('PlatformOpsProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_ops', () => {
			const result = loadAndParseProperty('properties/platform_ops/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformOpsProperty');
			const prop = result.value as PlatformOpsProperty;
			expect(prop.target).toBe('spi_ops');
			expect(prop.capability).toEqual(['spi']);
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
