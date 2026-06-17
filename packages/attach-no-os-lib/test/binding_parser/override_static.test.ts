import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseBinding } from '../test_utils';
import { BindingStruct } from '../../src/bindings_parser/types';

describe('OverrideStatic parsing', () => {
	describe('valid cases', () => {
		test('parses basic static override', () => {
			const result = loadAndParseBinding('overrides/static/valid_basic.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override).toBeDefined();
			expect(binding.$override).toHaveLength(1);
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses number property override with min/max/default/description', () => {
			const result = loadAndParseBinding('overrides/static/valid_number_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses enum property override with default', () => {
			const result = loadAndParseBinding('overrides/static/valid_enum_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses enum property override with values', () => {
			const result = loadAndParseBinding('overrides/static/valid_enum_values_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses boolean property override with default', () => {
			const result = loadAndParseBinding('overrides/static/valid_bool_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses include property override with pointer', () => {
			const result = loadAndParseBinding('overrides/static/valid_include_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});

		test('parses union property override with value', () => {
			const result = loadAndParseBinding('overrides/static/valid_union_override.yaml');
			expectOk(result);
			const binding = result.value as BindingStruct;
			expect(binding.$override![0]._t).toBe('OverrideStatic');
		});
	});

	describe('error cases', () => {
		test('rejects multiple keys in static override', () => {
			const result = loadAndParseBinding('overrides/static/multiple_keys.yaml');
			expectError(result);
			expectErrorContains(result, 'exactly one property key');
		});

		test('rejects unknown property', () => {
			const result = loadAndParseBinding('overrides/static/unknown_property.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});

		test('rejects number override with minimum below type minimum', () => {
			const result = loadAndParseBinding('overrides/static/invalid_number_minimum.yaml');
			expectError(result);
			expectErrorContains(result, 'below type minimum');
		});

		test('rejects number override with maximum above type maximum', () => {
			const result = loadAndParseBinding('overrides/static/invalid_number_maximum.yaml');
			expectError(result);
			expectErrorContains(result, 'above type maximum');
		});

		test('rejects enum override with invalid default', () => {
			const result = loadAndParseBinding('overrides/static/invalid_enum_default.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid default 'D'");
		});

		test('rejects union override with invalid member value', () => {
			const result = loadAndParseBinding('overrides/static/invalid_union_value.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid union member 'uart'");
		});
	});
});
