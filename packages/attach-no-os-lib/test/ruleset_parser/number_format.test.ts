import { describe, test, expect } from 'vitest';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { format_number, format_number_in } from '../../src/ruleset_parser/number_format';
import { number_literal } from '../../src/codegen/codegen_helpers';
import { NumberProperty } from '../../src/ruleset_parser/types';

// A numeric field can declare the radix it reads in, so an address or a bitmask appears the
// way the datasheet writes it — both in a generated initializer and in the error that
// rejected it. The radix is a property of the FIELD, not of a written value: a workfile is
// JSON, which has no hex literal, so nothing about `0x1D` survives being stored.

function number_property(body: string): NumberProperty {
    const parsed = parse_ruleset(`$type: struct\n$symbol: t\nfield: {${body}}\n`);
    if (!parsed.ok) {
        throw new Error(`parse failed: ${parsed.error.message}`);
    }
    if (parsed.value._t !== "RulesetStruct") {
        throw new Error("expected a struct");
    }
    return parsed.value.properties[0] as NumberProperty;
}

describe('numeric format', () => {
    test('hex is parsed off the field', () => {
        expect(number_property('type: uint16_t, format: hex').format).toBe("hex");
        expect(number_property('type: uint16_t').format).toBeUndefined();
    });

    test('a non-integer type cannot declare a radix', () => {
        // C's hex float literals mean something else entirely, and nobody reads one.
        const parsed = parse_ruleset(`$type: struct\n$symbol: t\nf: {type: float, format: hex}\n`);
        expect(parsed.ok).toBe(false);
    });

    test('an unknown format is refused rather than ignored', () => {
        const parsed = parse_ruleset(`$type: struct\n$symbol: t\na: {type: uint8_t, format: octal}\n`);
        expect(parsed.ok).toBe(false);
    });

    test('hex renders with the sign outside the prefix', () => {
        // C reads `-0x10` as negation of a literal; `0x-10` is not a token.
        expect(format_number_in(29, "hex")).toBe("0x1D");
        expect(format_number_in(0, "hex")).toBe("0x0");
        expect(format_number_in(-16, "hex")).toBe("-0x10");
    });

    test('no declared format means decimal', () => {
        expect(format_number_in(29, undefined)).toBe("29");
    });

    test('a value that is not a finite integer is left alone', () => {
        // The validator reports these; rendering them as hex would hide what is there.
        expect(format_number_in(1.5, "hex")).toBe("1.5");
        expect(format_number_in(Number.NaN, "hex")).toBe("NaN");
    });

    test('format_number honours the field, and ignores a float type', () => {
        expect(format_number(29, number_property('type: uint16_t, format: hex'))).toBe("0x1D");
        expect(format_number(29, number_property('type: uint16_t'))).toBe("29");
        expect(format_number(1.5, number_property('type: float'))).toBe("1.5");
    });

    test('codegen emits the declared radix', () => {
        expect(number_literal(29, number_property('type: uint16_t, format: hex'))).toBe("0x1D");
        expect(number_literal(29, number_property('type: uint16_t'))).toBe("29");
    });

    test('a value entered in decimal still emits as hex', () => {
        // The point of declaring it on the field: the author of the value need not know.
        expect(number_literal(83, number_property('type: uint16_t, format: hex'))).toBe("0x53");
    });

    test('an array element can declare it too', () => {
        // Array elements go through the same number parser, so a register table emits as
        // {0x1D, 0x53} without anything extra.
        const parsed = parse_ruleset(
            `$type: struct\n$symbol: t\nregs: {type: array, size: 2, element: {type: uint8_t, format: hex}}\n`
        );
        if (!parsed.ok || parsed.value._t !== "RulesetStruct") {
            throw new Error("parse failed");
        }
        const property = parsed.value.properties[0];
        if (property._t !== "ArrayProperty" || property.element._t !== "NumberProperty") {
            throw new Error("expected an array of numbers");
        }
        expect(property.element.format).toBe("hex");
        expect(number_literal(29, property.element)).toBe("0x1D");
    });

    test('float literals are untouched by the radix path', () => {
        expect(number_literal(1, number_property('type: float'))).toBe("1.0f");
        expect(number_literal(1, number_property('type: double'))).toBe("1.0");
    });
});
