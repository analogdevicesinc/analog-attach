import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { PlatformOpsProperty } from '../../src/bindings_parser/types';

describe('PlatformOpsProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_ops', () => {
			const result = loadAndParseProperty('properties/platform_ops/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformOpsProperty');
			const prop = result.value as PlatformOpsProperty;
			expect(prop.target).toBe('spi_ops');
			expect(prop.platforms).toHaveLength(2);
		});
	});

	describe('error cases', () => {
		test('rejects missing target', () => {
			const result = loadAndParseProperty('properties/platform_ops/missing_target.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'target'");
		});

		test('rejects missing platforms', () => {
			const result = loadAndParseProperty('properties/platform_ops/missing_platforms.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'platforms'");
		});

		test('rejects platforms not being an array', () => {
			const result = loadAndParseProperty('properties/platform_ops/platforms_not_array.yaml');
			expectError(result);
			expectErrorPath(result, 'platforms');
			expectErrorContains(result, 'Expected array');
		});
	});
});
