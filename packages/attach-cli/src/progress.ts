// Progress lines for the slow cache build (the compat index and the validation
// schemas, see config/rebuild.ts). They go to stderr in every mode, so stdout
// and --json responses stay clean.

/** 4.2s under 10 seconds, 48s under a minute, then 1m 12s. */
export function format_duration(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 10) { return `${seconds.toFixed(1)}s`; }
    if (seconds < 60) { return `${Math.round(seconds)}s`; }
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

export interface ProgressStream {
    isTTY?: boolean;
    write(chunk: string): boolean;
}

export interface Progress {
    update(done: number, total: number): void;
    done(message: string): void;
}

/**
 * Print `message` and keep a counter after it. On a TTY the line is rewritten
 * in place and replaced by the done line; otherwise only the start line and
 * the done line are printed.
 */
export function start_progress(message: string, stream: ProgressStream = process.stderr): Progress {
    const tty = stream.isTTY === true;
    stream.write(tty ? message : `${message}\n`);
    return {
        update: (done, total) => { if (tty) { stream.write(`\r${message} ${done}/${total}`); } },
        done: (line) => { stream.write(tty ? `\r\u001B[2K${line}\n` : `${line}\n`); },
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const capture = (tty: boolean): { stream: ProgressStream; text: () => string } => {
        let written = "";
        return { stream: { isTTY: tty, write: (chunk: string) => { written += chunk; return true; } }, text: () => written };
    };

    test("format_duration - tenths under 10s, seconds, then minutes", () => {
        expect(format_duration(4200)).toBe("4.2s");
        expect(format_duration(48_000)).toBe("48s");
        expect(format_duration(72_000)).toBe("1m 12s");
    });

    test("progress - a TTY rewrites one line with a counter, then replaces it", () => {
        const { stream, text } = capture(true);
        const progress = start_progress("Indexing device bindings (first run)...", stream);
        progress.update(1, 3);
        progress.update(3, 3);
        progress.done("Indexed 2 compatibles from 3 bindings in 1.0s");
        expect(text()).toBe(
            "Indexing device bindings (first run)..."
            + "\rIndexing device bindings (first run)... 1/3"
            + "\rIndexing device bindings (first run)... 3/3"
            + "\r\u001B[2KIndexed 2 compatibles from 3 bindings in 1.0s\n",
        );
    });

    test("progress - not a TTY: the start line and the done line only", () => {
        const { stream, text } = capture(false);
        const progress = start_progress("Indexing device bindings (first run)...", stream);
        progress.update(1, 3);
        progress.done("Indexed 2 compatibles from 3 bindings in 1.0s");
        expect(text()).toBe("Indexing device bindings (first run)...\nIndexed 2 compatibles from 3 bindings in 1.0s\n");
    });
}
