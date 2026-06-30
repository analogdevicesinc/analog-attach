import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { UnionProperty } from '../../src/ruleset_parser/types';

describe('UnionProperty parsing', () => {
	describe('valid cases', () => {
		test('parses with two members', () => {
			const result = loadAndParseProperty('properties/union/valid_two_members.yaml');
			expectOk(result);
			expect(result.value._t).toBe('UnionProperty');
			const property = result.value as UnionProperty;
			expect(property.members).toHaveLength(2);
			expect(property.members[0].name).toBe('spi_init');
			expect(property.members[1].name).toBe('i2c_init');
		});

		test('parses with multiple members', () => {
			const result = loadAndParseProperty('properties/union/valid_multiple_members.yaml');
			expectOk(result);
			const property = result.value as UnionProperty;
			expect(property.members).toHaveLength(3);
			expect(property.description).toBe('Communication interface');
			expect(property.required).toBe(true);
		});
	});

	describe('error cases', () => {
		test('rejects missing members field', () => {
			const result = loadAndParseProperty('properties/union/missing_members.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'members'");
		});

		test('rejects members not being an array', () => {
			const result = loadAndParseProperty('properties/union/members_not_array.yaml');
			expectError(result);
			expectErrorPath(result, 'members');
			expectErrorContains(result, 'Expected array');
		});

		test('rejects member with multiple keys', () => {
			const result = loadAndParseProperty('properties/union/member_multiple_keys.yaml');
			expectError(result);
			expectErrorContains(result, 'exactly one key');
		});

		test('rejects member missing include', () => {
			const result = loadAndParseProperty('properties/union/member_missing_include.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'include'");
		});
	});
});
