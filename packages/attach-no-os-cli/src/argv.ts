/**
 * Argv normalization for attach-meta compatibility.
 *
 * attach-meta emits global flags in fixed positions:
 *
 *     <binary> [--json] <argv...> [--workfile <path>] <trailing args...>
 *
 * stricli only accepts flags after the route words, so `--json read` fails with
 * "No command registered for `--json`". It does accept them anywhere after the
 * route, so moving both globals to the end is enough. Side benefit: `aa --json read`
 * works for humans too.
 */

export type NormalizedArgv = {
    /** Argv to hand to stricli. */
    argv: string[];
    /** Value of --workfile, if present. */
    workfile?: string;
};

/**
 * Move `--json` to the end of argv and pull `--workfile <path>` out of it.
 *
 * `--workfile` is returned separately rather than moved: no command declares it as a
 * flag, so leaving it in argv would trip stricli's "No flag registered" check.
 * Callers put it on the AttachContext instead (see src/bin/cli.ts).
 */
export function normalize_argv(input: string[]): NormalizedArgv {
    const argv: string[] = [];
    let json = false;
    let workfile: string | undefined;

    for (let index = 0; index < input.length; index++) {
        const token = input[index];

        if (token === "--json") {
            json = true;
            continue;
        }

        if (token === "--workfile") {
            workfile = input[index + 1];
            index++;
            continue;
        }

        if (token.startsWith("--workfile=")) {
            workfile = token.slice("--workfile=".length);
            continue;
        }

        argv.push(token);
    }

    if (json) {
        argv.push("--json");
    }

    return workfile === undefined ? { argv } : { argv, workfile };
}
