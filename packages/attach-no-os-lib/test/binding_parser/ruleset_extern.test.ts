import { describe, test, expect } from 'vitest';
import { expectErrorContains, expectOk, loadAndParseRuleset } from '../test_utilities';
import { provided_id, RulesetExtern, RulesetType } from '../../src/ruleset_parser/types';

describe('RulesetExtern parsing', () => {
	describe('valid cases', () => {
		test('parses a minimal extern binding', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_minimal.yaml');
			expectOk(result);
			expect(result.value._t).toBe('RulesetExtern');
			expect(result.value.$type).toBe(RulesetType.RT_EXTERN);
			expect(result.value.$symbol).toBe('iio_test_device');
		});

		test('$provides and $header are read', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_minimal.yaml');
			expectOk(result);
			const binding = result.value as RulesetExtern;
			expect(binding.$provides).toBe('test/iio_device');
			expect(binding.$header).toBe('drivers/test/iio_test.h');
		});

		// An extern is the one kind whose matching type is not its own $id.
		test('provided_id answers with $provides, not $id', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_minimal.yaml');
			expectOk(result);
			expect(provided_id(result.value)).toBe('test/iio_device');
		});

		// Most externs name a struct, so the common case must stay non-array without
		// having to say so.
		test('$array defaults to false', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_minimal.yaml');
			expectOk(result);
			expect((result.value as RulesetExtern).$array).toBe(false);
		});

		test('parses $array', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_array.yaml');
			expectOk(result);
			expect((result.value as RulesetExtern).$array).toBe(true);
		});

		// The symbol is already compiled into the library, so there is nothing to list.
		test('$sources is optional and defaults to empty', () => {
			const result = loadAndParseRuleset('bindings/extern/valid_minimal.yaml');
			expectOk(result);
			expect(result.value.$sources).toEqual({});
		});
	});

	describe('invalid cases', () => {
		test('rejects a missing $provides', () => {
			const result = loadAndParseRuleset('bindings/extern/invalid_no_provides.yaml');
			expectErrorContains(result, '$provides');
		});
	});
});
