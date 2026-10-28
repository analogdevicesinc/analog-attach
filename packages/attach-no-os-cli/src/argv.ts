/**
 * Argv normalization.
 *
 * stricli accepts flags anywhere after the route words, but not before the route, which is
 * how a person naturally types `--json`: `attach-noos --json read`. So `--json` is moved to
 * the end, and both spellings work.
 */

export type NormalizedArgv = {
    /** Argv to hand to stricli. */
    argv: string[];
};

export function normalize_argv(input: string[]): NormalizedArgv {
    const wants_json = input.includes("--json");
    const argv = input.filter(token => token !== "--json");

    if (wants_json) {
        argv.push("--json");
    }

    return { argv };
}
