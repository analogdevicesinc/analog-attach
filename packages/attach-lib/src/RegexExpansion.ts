export function expand_regex(regex: RegExp): string[] {
    // TODO : consider failing expansion if start and end anchor aren't present
    const pattern = regex.source
        .replace(/^\^/, '')  // remove start anchor
        .replace(/\$$/, ''); // remove end anchor

    return expand_pattern(pattern);
}

function expand_pattern(pattern: string): string[] {
    // Expand alternations (?:a|b|c)
    const altMatch = pattern.match(/\(\?:([^)]+)\)/);
    if (altMatch) {
        const [full, inner] = altMatch;
        const options = inner.split('|').flatMap(option => expand_pattern(option));
        return options.flatMap(opt =>
            expand_pattern(pattern.replace(full, opt))
        );
    }

    // Expand simple alternations (a|b)
    const parenAlt = pattern.match(/\(([^)]+)\)/);
    if (parenAlt && !parenAlt[1].includes('?:')) {
        const [full, inner] = parenAlt;
        const options = inner.split('|').flatMap(option => expand_pattern(option));
        return options.flatMap(opt =>
            expand_pattern(pattern.replace(full, opt))
        );
    }

    // Expand character classes like [13579] or [0-9a-f]
    const classMatch = pattern.match(/\[([^\]]+)\]/);
    if (classMatch) {
        const [full, chars] = classMatch;
        const expandedChars: string[] = [];

        for (let index = 0; index < chars.length; index++) {
            const c = chars[index];
            if (index + 2 < chars.length && chars[index + 1] === '-') {
                // Handle ranges like 0-9 or a-f
                const start = chars.codePointAt(index);
                const end = chars.codePointAt(index + 2);

                if (start === undefined || end === undefined) {
                    throw new Error("Fail");
                }

                for (let code = start; code <= end; code++) {
                    expandedChars.push(String.fromCodePoint(code));
                }
                index += 2;
            } else {
                expandedChars.push(c);
            }
        }

        return expandedChars.flatMap(ch =>
            expand_pattern(pattern.replace(full, ch))
        );
    }

    // No more special constructs — return as-is
    return [pattern];
}