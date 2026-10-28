import { describe, expect, it } from "vitest";
import { normalize_argv } from "../src/argv";

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
        expect(normalize_argv(["--json", "delete", "adxl0", "--force"]).argv).toEqual([
            "delete", "adxl0", "--force", "--json",
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
});
