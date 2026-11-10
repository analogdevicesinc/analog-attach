/** dtc's integers are unsigned 64-bit. */
const MASK = 0xFF_FF_FF_FF_FF_FF_FF_FFn;

/** dtc's integer literal (`dtc-lexer.l`), its suffixes ignored as `strtoull` ignores them, then the operators. */
const TOKEN = /\s*(?:(0[xX][\dA-Fa-f]+|\d+)(?:ULL|UL|U|LL|L)?|(<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%&|^~!<>?:()]))/y;

/** The literal as `strtoull(…, 0)` reads it: a leading `0` is octal, and a digit past it or a value past 64 bits is an error. */
function literal(text: string): bigint | undefined {
    if (/^0[xX]/.test(text)) { return BigInt(text); }
    if (text.length > 1 && text.startsWith("0")) { return /^[0-7]+$/.test(text) ? BigInt(`0o${text.slice(1)}`) : undefined; }
    return BigInt(text);
}

/** A failure anywhere: dtc refuses the whole expression (a division by zero is an error in an untaken branch too). */
class NotEvaluated extends Error {}

const truth = (value: boolean): bigint => (value ? 1n : 0n);

/** The divisor, which dtc refuses when it is 0. */
function nonzero(divisor: bigint): bigint {
    if (divisor === 0n) { throw new NotEvaluated(); }
    return divisor;
}

/**
 * The value of a cell expression as dtc computes it (`integer_expr` of `dtc-parser.y`), from the text the parser keeps
 * (`(4<<8|0x03)`, its tokens concatenated): from `?:`, the lowest and right to left, through `|| && | ^ & == != < > <=
 * >= << >> + - * / %` to the unary `- ~ !`, unsigned 64-bit, a shift by 64 or more 0. Undefined for an identifier (a
 * macro the workfile doesn't expand), a division by zero, or anything else dtc would refuse.
 */
export function evaluate_expression(text: string): bigint | undefined {
    const tokens: string[] = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < text.length) {
        const start = TOKEN.lastIndex;
        const match = TOKEN.exec(text);
        if (match === null) {
            if (text.slice(start).trim() === "") { break; }
            return undefined;
        }
        const [, number, operator] = match;
        tokens.push(number ?? operator ?? "");
    }

    let position = 0;
    const peek = (): string | undefined => tokens[position];
    const take = (expected: string): void => {
        if (tokens[position] !== expected) { throw new NotEvaluated(); }
        position++;
    };

    /** Left to right over the operators of one level. */
    const binary = (next: () => bigint, operators: Record<string, (a: bigint, b: bigint) => bigint>) => (): bigint => {
        let value = next();
        for (let operator = peek(); operator !== undefined && Object.hasOwn(operators, operator); operator = peek()) {
            position++;
            value = operators[operator]!(value, next()) & MASK;
        }
        return value;
    };

    const primary = (): bigint => {
        const token = peek();
        if (token === "(") {
            position++;
            const value = conditional();
            take(")");
            return value;
        }
        if (token === undefined || !/^\d/.test(token)) { throw new NotEvaluated(); }
        position++;
        const value = literal(token);
        if (value === undefined || value > MASK) { throw new NotEvaluated(); }
        return value;
    };
    const unary = (): bigint => {
        switch (peek()) {
            case "-": { position++; return -unary() & MASK; }
            case "~": { position++; return ~unary() & MASK; }
            case "!": { position++; return truth(unary() === 0n); }
            default: { return primary(); }
        }
    };
    const product = binary(unary, { "*": (a, b) => a * b, "/": (a, b) => a / nonzero(b), "%": (a, b) => a % nonzero(b) });
    const sum = binary(product, { "+": (a, b) => a + b, "-": (a, b) => a - b });
    const shift = binary(sum, { "<<": (a, b) => (b < 64n ? a << b : 0n), ">>": (a, b) => (b < 64n ? a >> b : 0n) });
    const relation = binary(shift, { "<": (a, b) => truth(a < b), ">": (a, b) => truth(a > b), "<=": (a, b) => truth(a <= b), ">=": (a, b) => truth(a >= b) });
    const equality = binary(relation, { "==": (a, b) => truth(a === b), "!=": (a, b) => truth(a !== b) });
    const bit_and = binary(equality, { "&": (a, b) => a & b });
    const bit_xor = binary(bit_and, { "^": (a, b) => a ^ b });
    const bit_or = binary(bit_xor, { "|": (a, b) => a | b });
    const logical_and = binary(bit_or, { "&&": (a, b) => truth(a !== 0n && b !== 0n) });
    const logical_or = binary(logical_and, { "||": (a, b) => truth(a !== 0n || b !== 0n) });
    // Both branches are computed, as dtc does
    function conditional(): bigint {
        const condition = logical_or();
        if (peek() !== "?") { return condition; }
        position++;
        const then = conditional();
        take(":");
        const otherwise = conditional();
        return condition === 0n ? otherwise : then;
    }

    try {
        const value = conditional();
        return position === tokens.length ? value : undefined;
    } catch (error) {
        if (error instanceof NotEvaluated) { return undefined; }
        throw error;
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const MAX = 0xFF_FF_FF_FF_FF_FF_FF_FFn;

    test("evaluate_expression — precedence and grouping", () => {
        expect(evaluate_expression("(1+2*3)")).toBe(7n);
        expect(evaluate_expression("((1+2)*3)")).toBe(9n);
        expect(evaluate_expression("(1<<4|1)")).toBe(17n);
        expect(evaluate_expression("(1|2^3&4)")).toBe(3n);
        expect(evaluate_expression("(10-2-3)")).toBe(5n);
        expect(evaluate_expression("(100/10/5)")).toBe(2n);
        expect(evaluate_expression("(7%4*2)")).toBe(6n);
        expect(evaluate_expression("(1+2<<1)")).toBe(6n);
        expect(evaluate_expression("(1<2==1)")).toBe(1n);
        expect(evaluate_expression("(2>=3||1&&2)")).toBe(1n);
    });

    test("evaluate_expression — the macros of real devicetrees", () => {
        // qcom's ADC channels, `(SID << 8 | ch)`, and Marvell's MBUS_ID(t, a)
        expect(evaluate_expression("(4<<8|0x03)")).toBe(0x04_03n);
        expect(evaluate_expression("(((0xf0)<<24)|((0x01)<<16))")).toBe(0xF0_01_00_00n);
    });

    test("evaluate_expression — unsigned 64-bit arithmetic", () => {
        expect(evaluate_expression("(-1)")).toBe(MAX);
        expect(evaluate_expression("(~0)")).toBe(MAX);
        expect(evaluate_expression("(!0)")).toBe(1n);
        expect(evaluate_expression("(!5)")).toBe(0n);
        expect(evaluate_expression("(0-1>0)")).toBe(1n);
        expect(evaluate_expression("(1--1)")).toBe(2n);
        expect(evaluate_expression("(1<<64)")).toBe(0n);
        expect(evaluate_expression("(1<<63)")).toBe(0x80_00_00_00_00_00_00_00n);
        expect(evaluate_expression("(-1>>64)")).toBe(0n);
        expect(evaluate_expression("(0xffffffffffffffff+2)")).toBe(1n);
    });

    test("evaluate_expression — the conditional, right to left", () => {
        expect(evaluate_expression("(1?2:3)")).toBe(2n);
        expect(evaluate_expression("(0?2:3)")).toBe(3n);
        expect(evaluate_expression("(0?1:0?2:3)")).toBe(3n);
        expect(evaluate_expression("(1?0?4:5:6)")).toBe(5n);
    });

    test("evaluate_expression — literals: hex, octal, suffixes", () => {
        expect(evaluate_expression("(0x10ULL)")).toBe(16n);
        expect(evaluate_expression("(0X1F)")).toBe(31n);
        expect(evaluate_expression("(010)")).toBe(8n);
        expect(evaluate_expression("(0)")).toBe(0n);
        expect(evaluate_expression("(10U+1L+1UL+1LL)")).toBe(13n);
    });

    test("evaluate_expression — what doesn't evaluate", () => {
        expect(evaluate_expression("(FOO+1)")).toBeUndefined();
        expect(evaluate_expression("(MY_ADDR)")).toBeUndefined();
        expect(evaluate_expression("(1/0)")).toBeUndefined();
        expect(evaluate_expression("(1%0)")).toBeUndefined();
        expect(evaluate_expression("(1+")).toBeUndefined();
        expect(evaluate_expression("(1 2)")).toBeUndefined();
        expect(evaluate_expression("(09)")).toBeUndefined();
        expect(evaluate_expression("()")).toBeUndefined();
        expect(evaluate_expression("")).toBeUndefined();
    });
}
