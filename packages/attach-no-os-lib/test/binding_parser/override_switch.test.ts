import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseBinding } from '../test_utils';
import { BindingStruct } from '../../src/bindings_parser/types';

describe('OverrideSwitch parsing', () => {
	describe('valid cases', () => {
		test('parses basic switch override', () => {
			const result = loadAndParseBinding('overrides/switch/valid_basic.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override).toBeDefined();
			expect(binding.$override).toHaveLength(1);
			expect(binding.$override![0]._t).toBe('OverrideSwitch');
		});

		test('parses switch with parent scope', () => {
			const result = loadAndParseBinding('overrides/switch/valid_with_parent_scope.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override).toBeDefined();
			expect(binding.$override![0]._t).toBe('OverrideSwitch');
			expect(binding.$override![0].scope).toBe('$parent');
		});
	});

	describe('error cases', () => {
		test('rejects missing $on', () => {
			const result = loadAndParseBinding('overrides/switch/missing_on.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$on'");
		});

		test('rejects missing $cases', () => {
			const result = loadAndParseBinding('overrides/switch/missing_cases.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$cases'");
		});

		test('rejects invalid case name', () => {
			const result = loadAndParseBinding('overrides/switch/invalid_case_name.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid case 'C'");
		});

		test('rejects unknown property in $on', () => {
			const result = loadAndParseBinding('overrides/switch/unknown_property.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});
	});
});
