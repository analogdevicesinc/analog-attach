import * as fs from "node:fs";
import path from "node:path";

import { Result } from "attach-lib";

import type { ErrorType } from "../../interface/error-types";
import type { Workspace } from "./config/workspace";
import { run_preprocess } from "./utilities";

/**
 * How the full devicetree names the base: relative to its own directory, which
 * is where cpp looks first, or absolute when the two share no directory but the root.
 */
export function include_path(source: string, base: string): string {
    const relative = path.relative(path.dirname(source), base);
    const shared = relative.split(path.sep).filter(segment => segment === "..").length < path.dirname(source).split(path.sep).filter(Boolean).length;
    return (shared ? relative : base).split(path.sep).join("/");
}

/**
 * The base with the overlay applied (output `full`): write `source`, a devicetree
 * that includes the base file and adds the overlay's fragments as `&label { … }`
 * blocks, with `epilogue` after them, then preprocess it as the base is into
 * `preprocessed`. Gives the refusal's reason and type, or undefined.
 */
export function write_full_devicetree(
    workspace: Workspace<"base" | "overlay">,
    source: string,
    preprocessed: string,
    epilogue = "",
): { message: string; type: ErrorType } | undefined {
    const printed = workspace.overlay.tree.print_full(include_path(source, workspace.base.source));
    if (!Result.is_ok(printed)) {
        return { message: `the target of ${printed.error.join(", ")} is in neither the base devicetree nor the overlay`, type: "bad-reference" };
    }
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, printed.value + epilogue);

    fs.mkdirSync(path.dirname(preprocessed), { recursive: true });
    const { linux, preprocess_command } = workspace.settings;
    const error = run_preprocess(preprocess_command, { input: source, output: preprocessed, ...(linux === undefined ? {} : { linux }) });
    return error === undefined ? undefined : { message: `preprocessing ${source} failed:\n${error}`, type: "tool-failed" };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("include_path - the base relative to the full devicetree's directory", () => {
        expect(include_path("/w/overlay.dts", "/w/base.dts")).toBe("base.dts");
        expect(include_path("/home/u/w/build/overlay.dts", "/home/u/linux/board.dts")).toBe("../../linux/board.dts");
        expect(include_path("/tmp/w/overlay.dts", "/home/u/linux/board.dts")).toBe("/home/u/linux/board.dts");
    });
}
