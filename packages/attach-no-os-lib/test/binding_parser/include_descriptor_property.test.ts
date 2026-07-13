import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { IncludeDescriptorProperty } from '../../src/ruleset_parser/types';

describe('IncludeDescriptorProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic include_descriptor', () => {
			const result = loadAndParseProperty('properties/include_descriptor/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('IncludeDescriptorProperty');
			const property = result.value as IncludeDescriptorProperty;
			expect(property.include_descriptor).toBe('no-os/spi/no_os_spi_init_param.yaml');
			expect(property.pointer).toBe(true); // default is true for descriptors
		});

		test('parses with pointer set to false', () => {
			const result = loadAndParseProperty('properties/include_descriptor/valid_with_pointer_false.yaml');
			expectOk(result);
			const property = result.value as IncludeDescriptorProperty;
			expect(property.include_descriptor).toBe('no-os/gpio/no_os_gpio_init_param.yaml');
			expect(property.pointer).toBe(false);
			expect(property.description).toBe('GPIO descriptor (not a pointer)');
		});

		test('parses with all optional fields', () => {
			const result = loadAndParseProperty('properties/include_descriptor/valid_with_description.yaml');
			expectOk(result);
			const property = result.value as IncludeDescriptorProperty;
			expect(property.include_descriptor).toBe('no-os/spi/no_os_spi_init_param.yaml');
			expect(property.pointer).toBe(true);
			expect(property.description).toBe('Parent SPI descriptor for devices behind expanders');
			expect(property.required).toBe(false);
		});
	});

	describe('error cases', () => {
		test('rejects missing include_descriptor field', () => {
			const result = loadAndParseProperty('properties/include_descriptor/missing_include_descriptor.yaml');
			expectError(result);
			expectErrorContains(result, 'Cannot determine the property type');
		});

		test('rejects include_descriptor not being a string', () => {
			const result = loadAndParseProperty('properties/include_descriptor/include_descriptor_not_string.yaml');
			expectError(result);
			expectErrorPath(result, 'include_descriptor');
			expectErrorContains(result, 'Expected string');
		});
	});
});
