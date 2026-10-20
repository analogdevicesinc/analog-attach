import type { StaleReason } from "./config/cache";

// Progress lines for slow cache builds (the compat index, the validation
// schemas, the overlay index). They go to stderr in every mode, so stdout and
// --json responses stay clean; shell completion never builds a cache, so it
// never prints them.

export type CacheSubject = "index" | "schemas" | "overlays";

const REBUILD: Record<CacheSubject, { first: string; sources: string; changed: string; action: string }> = {
    index: { first: "Indexing device bindings", sources: "Bindings", changed: "the last index", action: "re-indexing" },
    schemas: { first: "Compiling binding schemas for validation", sources: "Bindings", changed: "the last schema build", action: "recompiling binding schemas" },
    overlays: { first: "Indexing overlays", sources: "Overlays", changed: "the last overlay index", action: "re-indexing overlays" },
};

/** The line printed before a cache is (re)built, saying why. */
export function rebuild_message(subject: CacheSubject, reason: StaleReason): string {
    const words = REBUILD[subject];
    switch (reason.kind) {
        case "missing": { return `${words.first} (first run)...`; }
        case "stale": { return `${words.sources} changed since ${words.changed}, ${words.action}...`; }
        case "linux-changed": { return `Linux tree changed (${reason.from} → ${reason.to}), ${words.action}...`; }
    }
}

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

    test("rebuild_message - says why the index is built", () => {
        expect(rebuild_message("index", { kind: "missing" })).toBe("Indexing device bindings (first run)...");
        expect(rebuild_message("index", { kind: "stale" })).toBe("Bindings changed since the last index, re-indexing...");
        expect(rebuild_message("index", { kind: "linux-changed", from: "/old/linux", to: "/new/linux" }))
            .toBe("Linux tree changed (/old/linux → /new/linux), re-indexing...");
    });

    test("rebuild_message - the same reasons for the validation schemas", () => {
        expect(rebuild_message("schemas", { kind: "missing" })).toBe("Compiling binding schemas for validation (first run)...");
        expect(rebuild_message("schemas", { kind: "stale" })).toBe("Bindings changed since the last schema build, recompiling binding schemas...");
        expect(rebuild_message("schemas", { kind: "linux-changed", from: "/a", to: "/b" }))
            .toBe("Linux tree changed (/a → /b), recompiling binding schemas...");
    });

    test("rebuild_message - the overlay index", () => {
        expect(rebuild_message("overlays", { kind: "missing" })).toBe("Indexing overlays (first run)...");
        expect(rebuild_message("overlays", { kind: "stale" })).toBe("Overlays changed since the last overlay index, re-indexing overlays...");
        expect(rebuild_message("overlays", { kind: "linux-changed", from: "/a", to: "/b" }))
            .toBe("Linux tree changed (/a → /b), re-indexing overlays...");
    });

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
