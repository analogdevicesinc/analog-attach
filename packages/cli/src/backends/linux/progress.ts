// The duration in the summary of the slow cache build (the compat index and the
// validation schemas, see config/rebuild.ts). The progress lines themselves are
// the front end's (`session.progress`).

/** 4.2s under 10 seconds, 48s under a minute, then 1m 12s. */
export function format_duration(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 10) { return `${seconds.toFixed(1)}s`; }
    if (seconds < 60) { return `${Math.round(seconds)}s`; }
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("format_duration - tenths under 10s, seconds, then minutes", () => {
        expect(format_duration(4200)).toBe("4.2s");
        expect(format_duration(48_000)).toBe("48s");
        expect(format_duration(72_000)).toBe("1m 12s");
    });
}
