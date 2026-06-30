import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseProperty } from '../test_utilities';
import { PlatformExtraProperty } from '../../src/ruleset_parser/types';

describe('PlatformExtraProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_extra', () => {
			const result = loadAndParseProperty('properties/platform_extra/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformExtraProperty');
			const property = result.value as PlatformExtraProperty;
			expect(property.capability).toEqual(['spi']);
		});
	});
});
