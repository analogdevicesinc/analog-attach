import type { CommonResponse } from "./types";
import { bigIntReplacer } from "../utilities";

export function respond(response: object): void {
    console.log(JSON.stringify(response, bigIntReplacer));
    process.exitCode = 0;
}

export function respond_fail(response: CommonResponse): void {
    console.log(JSON.stringify(response, bigIntReplacer));
    process.exitCode = 0;
}

export function input_error(message: string): void {
    console.error(message);
    process.exitCode = 2;
}

/** The user stopped a prompt before anything was written (Ctrl-C, Ctrl-D): exit 130, so `init && add` stops there. */
export function cancelled(message: string): void {
    console.log(message);
    process.exitCode = 130;
}

export function diagnostic(message: string): void {
    console.error(message);
}

if (import.meta.vitest) {
    const { test, expect, vi } = import.meta.vitest;

    test("cancelled — says so on stdout and exits 130, as a shell does on Ctrl-C", () => {
        const saved = process.exitCode;
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            cancelled("Setup cancelled.");
            expect(log).toHaveBeenCalledWith("Setup cancelled.");
            expect(process.exitCode).toBe(130);
        } finally {
            log.mockRestore();
            process.exitCode = saved;
        }
    });
}
