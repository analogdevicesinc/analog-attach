import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseProperty } from '../test_utils';
import { PlatformExtraProperty } from '../../src/bindings_parser/types';

describe('PlatformExtraProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_extra', () => {
			const result = loadAndParseProperty('properties/platform_extra/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformExtraProperty');
			const prop = result.value as PlatformExtraProperty;
			expect(prop.capability).toEqual(['spi']);
		});
	});
});
