import { describe, test, expect } from 'vitest';
import { number_literal } from '../../src/codegen/codegen_helpers';
import { NumberProperty, PrimitiveSymbol } from '../../src/ruleset_parser/types';

function make_number(type: PrimitiveSymbol): NumberProperty {
    return { _t: "NumberProperty", name: "test_prop", description: "", type };
}

describe('number_literal', () => {
    describe('integer types', () => {
        test('emits an integer verbatim', () => {
            expect(number_literal(42, make_number("uint32_t"))).toBe("42");
        });

        test('emits a negative integer verbatim', () => {
            expect(number_literal(-128, make_number("int8_t"))).toBe("-128");
        });

        test('does not add a decimal point or suffix', () => {
            expect(number_literal(0, make_number("size_t"))).toBe("0");
        });
    });

    describe('float', () => {
        test('keeps the fractional part and adds the f suffix', () => {
            expect(number_literal(1000.5, make_number("float"))).toBe("1000.5f");
        });

        // A bare `1` assigned to a float field is an int literal; `1.0f` keeps the
        // token floating-point so C arithmetic on it does not truncate.
        test('adds .0 to a whole value so it stays floating-point', () => {
            expect(number_literal(1, make_number("float"))).toBe("1.0f");
        });

        test('handles negative values', () => {
            expect(number_literal(-2.5, make_number("float"))).toBe("-2.5f");
        });

        test('handles zero', () => {
            expect(number_literal(0, make_number("float"))).toBe("0.0f");
        });

        test('leaves exponent notation alone apart from the suffix', () => {
            expect(number_literal(1e30, make_number("float"))).toBe("1e+30f");
        });
    });

    describe('double', () => {
        test('keeps the fractional part with no suffix', () => {
            expect(number_literal(3.3, make_number("double"))).toBe("3.3");
        });

        test('adds .0 to a whole value', () => {
            expect(number_literal(5, make_number("double"))).toBe("5.0");
        });

        test('leaves exponent notation alone', () => {
            expect(number_literal(1e-9, make_number("double"))).toBe("1e-9");
        });
    });

    // Array element values arrive from the CLI as unparsed strings, so the helper
    // has to cope with them rather than assume a number.
    describe('non-number input', () => {
        test('coerces a numeric string for a float', () => {
            expect(number_literal("2.5", make_number("float"))).toBe("2.5f");
        });

        test('coerces a whole numeric string for a double', () => {
            expect(number_literal("7", make_number("double"))).toBe("7.0");
        });

        test('coerces a numeric string for an integer type', () => {
            expect(number_literal("12", make_number("uint16_t"))).toBe("12");
        });

        test('passes a non-numeric string through untouched', () => {
            expect(number_literal("SOME_MACRO", make_number("float"))).toBe("SOME_MACRO");
        });

        test('passes an empty string through rather than emitting 0', () => {
            expect(number_literal("", make_number("float"))).toBe("");
        });

        test('passes a non-finite value through rather than decorating it', () => {
            expect(number_literal(Number.NaN, make_number("float"))).toBe("NaN");
        });
    });
});
