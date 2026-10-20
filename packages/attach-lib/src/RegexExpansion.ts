/**
 * What a pattern matches: every name, when there are few enough, or else the
 * literal text all matches start with (empty when nothing is fixed).
 */
export type PatternExpansion = { names: string[] } | { stem: string };

/** The names a regex matches, all of them; empty when they are unbounded. */
export function expand_regex(regex: RegExp): string[] {
    const expansion = expand_pattern(regex.source, Number.POSITIVE_INFINITY);
    return "names" in expansion ? expansion.names : [];
}

/**
 * Expand the regex subset bindings use (literals, escapes, character classes,
 * groups with alternation, `?`, `*`, `+`, `{n,m}`, anchors) into the names it
 * matches. Unbounded parts (`+`, `*`, `.`, `[^…]`) and more than `cap` names
 * give the stem instead: `^fan-[0-9]+$` → "fan-".
 */
export function expand_pattern(pattern: string, cap = 32): PatternExpansion {
    const parser = { source: pattern, index: 0, cap };
    return parse_alternation(parser);
}

type Parser = { source: string; index: number; cap: number };

const ANY: PatternExpansion = { stem: "" };

function parse_alternation(parser: Parser): PatternExpansion {
    const branches = [parse_sequence(parser)];
    while (parser.source[parser.index] === "|") {
        parser.index++;
        branches.push(parse_sequence(parser));
    }
    return alternate(branches, parser.cap);
}

function parse_sequence(parser: Parser): PatternExpansion {
    let result: PatternExpansion = { names: [""] };
    while (parser.index < parser.source.length) {
        const c = parser.source[parser.index];
        if (c === "|" || c === ")") { break; }
        const atom = parse_atom(parser);
        result = concat(result, parse_quantifier(parser, atom), parser.cap);
    }
    return result;
}

function parse_atom(parser: Parser): PatternExpansion {
    const { source } = parser;
    const c = source[parser.index++]!;
    switch (c) {
        // Anchors match no text.
        case "^":
        case "$": {
            return { names: [""] };
        }
        case ".": {
            return ANY;
        }
        case "\\": {
            return escape(source[parser.index++] ?? "");
        }
        case "[": {
            return parse_class(parser);
        }
        case "(": {
            // Lookarounds aren't expanded; named and non-capturing groups are.
            if (["?=", "?!", "?<=", "?<!"].some(prefix => source.startsWith(prefix, parser.index))) {
                skip_group(parser);
                return ANY;
            }
            if (source.startsWith("?:", parser.index)) {
                parser.index += 2;
            } else if (source.startsWith("?<", parser.index)) {
                parser.index = source.indexOf(">", parser.index) + 1;
            }
            const inner = parse_alternation(parser);
            if (source[parser.index] === ")") { parser.index++; }
            return inner;
        }
        default: {
            return { names: [c] };
        }
    }
}

function escape(c: string): PatternExpansion {
    if (c === "d") { return { names: [..."0123456789"] }; }
    // \w, \s, \D, \b and the like stand for many characters.
    if (/[a-zA-Z]/.test(c)) { return ANY; }
    return { names: [c] };
}

function parse_class(parser: Parser): PatternExpansion {
    const { source } = parser;
    const skip_class = (): PatternExpansion => {
        const end = source.indexOf("]", parser.index);
        parser.index = end === -1 ? source.length : end + 1;
        return ANY;
    };
    if (source[parser.index] === "^") { return skip_class(); }

    const chars: string[] = [];
    while (parser.index < source.length && source[parser.index] !== "]") {
        const c = source[parser.index++]!;
        if (c === "\\") {
            const escaped = escape(source[parser.index++] ?? "");
            if (!("names" in escaped)) { return skip_class(); }
            chars.push(...escaped.names);
            continue;
        }
        const end = source[parser.index + 1];
        if (source[parser.index] === "-" && end !== undefined && end !== "]") {
            parser.index += 2;
            for (let code = c.codePointAt(0)!; code <= end.codePointAt(0)!; code++) {
                chars.push(String.fromCodePoint(code));
            }
            continue;
        }
        chars.push(c);
    }
    parser.index++;
    return limit({ names: [...new Set(chars)] }, parser.cap);
}

function parse_quantifier(parser: Parser, atom: PatternExpansion): PatternExpansion {
    const { source } = parser;
    const c = source[parser.index];
    let min: number;
    let max: number;
    if (c === "?") {
        [min, max] = [0, 1];
    } else if (c === "*") {
        [min, max] = [0, Number.POSITIVE_INFINITY];
    } else if (c === "+") {
        [min, max] = [1, Number.POSITIVE_INFINITY];
    } else if (c === "{") {
        const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(parser.index));
        if (match === null) { return atom; }
        min = Number(match[1]);
        max = match[2] === undefined ? min : (match[3] === "" ? Number.POSITIVE_INFINITY : Number(match[3]));
        parser.index += match[0].length - 1;
    } else {
        return atom;
    }
    parser.index++;
    // Lazy quantifiers match the same names.
    if (source[parser.index] === "?") { parser.index++; }
    return repeat(atom, min, max, parser.cap);
}

function skip_group(parser: Parser): void {
    let depth = 1;
    while (parser.index < parser.source.length && depth > 0) {
        const c = parser.source[parser.index++];
        if (c === "\\") { parser.index++; } else if (c === "(") { depth++; } else if (c === ")") { depth--; }
    }
}

function repeat(atom: PatternExpansion, min: number, max: number, cap: number): PatternExpansion {
    let current: PatternExpansion = { names: [""] };
    for (let count = 0; count < min; count++) {
        current = concat(current, atom, cap);
        if ("stem" in current) { return current; }
    }
    if (max === Number.POSITIVE_INFINITY) { return concat(current, ANY, cap); }
    const options: PatternExpansion[] = [current];
    for (let count = min; count < max; count++) {
        current = concat(current, atom, cap);
        options.push(current);
        if ("stem" in current) { break; }
    }
    return alternate(options, cap);
}

function concat(a: PatternExpansion, b: PatternExpansion, cap: number): PatternExpansion {
    if ("stem" in a) { return a; }
    // The text every match starts with: the one name and what follows, or what the names share.
    const stem = (rest: string): PatternExpansion => ({ stem: a.names.length === 1 ? a.names[0]! + rest : common_prefix(a.names) });
    if ("stem" in b) { return stem(b.stem); }
    if (a.names.length * b.names.length > cap) { return stem(common_prefix(b.names)); }
    return { names: a.names.flatMap(x => b.names.map(y => x + y)) };
}

function alternate(branches: PatternExpansion[], cap: number): PatternExpansion {
    if (branches.some(branch => "stem" in branch)) {
        return { stem: common_prefix(branches.flatMap(branch => "stem" in branch ? [branch.stem] : branch.names)) };
    }
    const names = [...new Set(branches.flatMap(branch => "names" in branch ? branch.names : []))];
    return limit({ names }, cap);
}

function limit(expansion: { names: string[] }, cap: number): PatternExpansion {
    return expansion.names.length > cap ? { stem: common_prefix(expansion.names) } : expansion;
}

function common_prefix(strings: string[]): string {
    const [first, ...rest] = strings;
    if (first === undefined) { return ""; }
    let length = first.length;
    for (const s of rest) {
        while (length > 0 && !s.startsWith(first.slice(0, length))) { length--; }
    }
    return first.slice(0, length);
}
