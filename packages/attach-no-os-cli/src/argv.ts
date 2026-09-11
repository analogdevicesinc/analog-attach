/**
 * Argv normalization for attach-meta compatibility.
 *
 * attach-meta appends its validated arguments to the argv we declared in the manifest, and
 * ours ends in `--json` (see src/protocol/manifest.ts). So the flag arrives *before* the
 * command's own positionals:
 *
 *     <binary> <command> --json <positionals...> [--flag value...]
 *
 * stricli accepts flags anywhere after the route words, so that already parses. What it
 * does not accept is a flag *before* the route — which is how a person naturally types it,
 * `aa --json read` — so `--json` is moved to the end and both spellings work.
 *
 * The other shape stricli cannot read is attach-meta's array flags. A protocol flag whose
 * base schema says `"type": "array"` is sent as one flag word followed by all of its
 * values, `--to soc spi0 adc`, while stricli's variadic flags want the word repeated,
 * `--to soc --to spi0 --to adc`. That rewrite happens here so no command has to know which
 * of the two forms it was handed.
 */

/**
 * The `"type": "array"` flags of aa-meta's per-command base schemas
 * (aa-meta/docs/schemas/command_base_schemas/), by route.
 *
 * Arity is a property of the command, not of the flag name: `--to` is an array for `add`
 * and `move`, and a single string for `rename`. Only the commands listed here have their
 * `--to` collapsed.
 */
const ARRAY_FLAGS: Readonly<Record<string, readonly string[]>> = {
    add: ["to"],
    move: ["to"],
};

export type NormalizedArgv = {
    /** Argv to hand to stricli. */
    argv: string[];
};

export function normalize_argv(input: string[]): NormalizedArgv {
    const wants_json = input.includes("--json");
    const without_json = input.filter(token => token !== "--json");

    // The route is the first word; attach-meta never puts anything before it, and a human
    // writing `aa --json read` has just had the flag lifted out.
    const argv = expand_array_flags(without_json[0], without_json);

    if (wants_json) {
        argv.push("--json");
    }

    return { argv };
}

/** `--to a b c` → `--to a --to b --to c`, for the array flags of this route only. */
function expand_array_flags(route: string | undefined, argv: string[]): string[] {
    const array_flags = route === undefined ? undefined : ARRAY_FLAGS[route];
    if (array_flags === undefined) {
        return [...argv];
    }

    const expanded: string[] = [];

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        const flag = token.startsWith("--") ? token.slice(2) : undefined;

        if (flag === undefined || !array_flags.includes(flag)) {
            expanded.push(token);
            continue;
        }

        // Every following token up to the next flag is one value of this one. A flag with
        // no values at all is passed through bare, so stricli reports the missing value
        // rather than this silently dropping the flag.
        let values = 0;
        while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
            expanded.push(token, argv[index + 1]);
            index++;
            values++;
        }

        if (values === 0) {
            expanded.push(token);
        }
    }

    return expanded;
}
