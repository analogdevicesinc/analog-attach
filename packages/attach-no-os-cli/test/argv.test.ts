import { describe, expect, it } from "vitest";
import { normalize_argv } from "../src/argv";
import { build_manifest } from "../src/protocol/manifest";

describe("normalize_argv", () => {
    it("moves a leading --json past the route", () => {
        expect(normalize_argv(["--json", "read"]).argv).toEqual(["read", "--json"]);
    });

    it("moves --json past positionals", () => {
        expect(normalize_argv(["--json", "read", "adxl0", "device_id"]).argv).toEqual([
            "read", "adxl0", "device_id", "--json",
        ]);
    });

    it("leaves command-specific flags in place", () => {
        expect(normalize_argv(["--json", "update", "adxl0", "spi_desc", "--with", "spi0"]).argv).toEqual([
            "update", "adxl0", "spi_desc", "--with", "spi0", "--json",
        ]);
    });

    it("keeps a trailing --json where it already is", () => {
        expect(normalize_argv(["read", "adxl0", "--json"]).argv).toEqual([
            "read", "adxl0", "--json",
        ]);
    });

    it("collapses a repeated --json to the single trailing one stricli expects", () => {
        expect(normalize_argv(["--json", "read", "--json"]).argv).toEqual(["read", "--json"]);
    });

    it("passes through an unknown route untouched so stricli reports it", () => {
        expect(normalize_argv(["bogus"]).argv).toEqual(["bogus"]);
    });

    it("is a no-op on argv that is already valid", () => {
        expect(normalize_argv(["read", "adxl0"]).argv).toEqual(["read", "adxl0"]);
    });

    it("splits an array flag's values into the repetitions stricli parses", () => {
        // attach-meta sends an array flag as the flag word once followed by every value
        // (`--to a b c`); stricli only understands one value per occurrence.
        expect(normalize_argv(["--json", "add", "adxl355", "--to", "root", "extra"]).argv).toEqual([
            "add", "adxl355", "--to", "root", "--to", "extra", "--json",
        ]);
    });

    it("leaves a single-valued array flag alone", () => {
        expect(normalize_argv(["add", "adxl355", "--to", "root", "--json"]).argv).toEqual([
            "add", "adxl355", "--to", "root", "--json",
        ]);
    });

    it("keeps a valueless array flag so stricli reports the missing value", () => {
        expect(normalize_argv(["add", "--to", "--name", "adxl0"]).argv).toEqual([
            "add", "--to", "--name", "adxl0",
        ]);
    });

    it("expands only the array flags of the route it was given", () => {
        // `--with` is a single-valued flag of `update`; a second word after it is a
        // positional, not another value, and must not be duplicated behind the flag.
        expect(normalize_argv(["update", "adxl0", "spi_desc", "--with", "spi0"]).argv).toEqual([
            "update", "adxl0", "spi_desc", "--with", "spi0",
        ]);
        expect(normalize_argv(["move", "adxl0", "--to", "a", "b"]).argv).toEqual([
            "move", "adxl0", "--to", "a", "--to", "b",
        ]);
    });

    it("does not expand a flag named --to on a route that has no array flags", () => {
        expect(normalize_argv(["rename", "adxl0", "--to", "adxl1"]).argv).toEqual([
            "rename", "adxl0", "--to", "adxl1",
        ]);
    });

    it("needs no per-command knowledge to normalize any declared command", () => {
        // attach-meta dispatches `<prefix> <route> --json <its own args...>`, which is what
        // the manifest's argv describes; whatever it hands us has to come out unchanged
        // apart from --json moving to the end.
        for (const [name, mapping] of Object.entries(build_manifest().commands)) {
            // The prefix's leading words are the interpreter and script, which never reach
            // normalize_argv — process.argv.slice(2) starts at the route.
            const route = mapping!.argv.slice(-2, -1);
            const dispatched = [...route, "--json", "some_node"];
            expect(normalize_argv(dispatched).argv, `${name} not normalized`).toEqual([
                ...route, "some_node", "--json",
            ]);
        }
    });
});
