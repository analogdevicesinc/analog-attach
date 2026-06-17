import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseBinding } from '../test_utils';
import { BindingStruct } from '../../src/bindings_parser/types';

describe('OverrideMutex parsing', () => {
	describe('valid cases', () => {
		test('parses mutex with two properties', () => {
			const result = loadAndParseBinding('overrides/mutex/valid_two_props.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override).toBeDefined();
			expect(binding.$override).toHaveLength(1);
			expect(binding.$override![0]._t).toBe('OverrideMutex');
		});

		test('parses mutex with multiple properties', () => {
			const result = loadAndParseBinding('overrides/mutex/valid_multiple_props.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideMutex');
		});
	});

	describe('error cases', () => {
		test('rejects $mutex not being an array', () => {
			const result = loadAndParseBinding('overrides/mutex/mutex_not_array.yaml');
			expectError(result);
			expectErrorContains(result, '$mutex must be an array');
		});

		test('rejects $mutex with only one property', () => {
			const result = loadAndParseBinding('overrides/mutex/mutex_one_prop.yaml');
			expectError(result);
			expectErrorContains(result, 'at least 2 properties');
		});

		test('rejects unknown property in mutex', () => {
			const result = loadAndParseBinding('overrides/mutex/mutex_unknown_prop.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});
	});
});
