import { describe, expect, it } from "vitest";
import { normalize_argv } from "../src/argv";
import { COMMANDS, PROTOCOL_VERSION, resolve_route } from "../src/protocol";

describe("normalize_argv", () => {
    it("moves a leading --json past the route", () => {
        expect(normalize_argv(["--json", "read"]).argv).toEqual(["read", "--json"]);
    });

    it("moves a leading --json past a two-word route", () => {
        expect(normalize_argv(["--json", "create", "node"]).argv).toEqual([
            "create", "node", "--json",
        ]);
    });

    it("moves --json past positionals", () => {
        expect(normalize_argv(["--json", "read", "adxl0", "device_id"]).argv).toEqual([
            "read", "adxl0", "device_id", "--json",
        ]);
    });

    it("extracts --workfile rather than passing it to stricli", () => {
        const result = normalize_argv(["read", "--workfile", "/tmp/wf.json"]);
        expect(result.workfile).toBe("/tmp/wf.json");
        expect(result.argv).toEqual(["read"]);
    });

    it("extracts --workfile= form", () => {
        const result = normalize_argv(["read", "--workfile=/tmp/wf.json"]);
        expect(result.workfile).toBe("/tmp/wf.json");
        expect(result.argv).toEqual(["read"]);
    });

    it("handles the full attach-meta argv shape", () => {
        // <binary> --json <argv...> --workfile <path> <trailing...>
        const result = normalize_argv([
            "--json", "read", "--workfile", "/tmp/wf.json", "adxl0",
        ]);
        expect(result.workfile).toBe("/tmp/wf.json");
        expect(result.argv).toEqual(["read", "adxl0", "--json"]);
    });

    it("reports no workfile when the flag is absent", () => {
        expect(normalize_argv(["read"]).workfile).toBeUndefined();
    });

    it("leaves command-specific flags in place", () => {
        expect(normalize_argv(["--json", "update", "--rename", "new_name"]).argv).toEqual([
            "update", "--rename", "new_name", "--json",
        ]);
    });

    it("passes through an unknown route untouched so stricli reports it", () => {
        expect(normalize_argv(["bogus"]).argv).toEqual(["bogus"]);
    });

    it("is a no-op on argv that is already valid", () => {
        expect(normalize_argv(["read", "adxl0"]).argv).toEqual(["read", "adxl0"]);
    });

    it("needs no per-command knowledge to normalize any route", () => {
        for (const [key, entry] of Object.entries(COMMANDS)) {
            if (!entry.supported) { continue; }
            const result = normalize_argv(["--json", ...entry.argv]);
            expect(result.argv, `${key} not normalized`).toEqual([...entry.argv, "--json"]);
        }
    });
});

describe("protocol table", () => {
    it("advertises the version attach-meta 0.2.x requires", () => {
        // attach-meta compares the breaking segment against its own crate version;
        // if this changes, aa-meta's Cargo.toml must match.
        expect(PROTOCOL_VERSION.split(".").slice(0, 2).join(".")).toBe("0.2");
    });

    it("covers every discovery key attach-meta knows about", () => {
        // Mirrors DiscoveryKey::ALL in aa-meta/src/schema.rs.
        const expected = [
            "create_node", "create_property", "create_workfile",
            "read_node", "read_property", "update",
            "delete_node", "delete_property", "validate",
            "generate", "build", "deploy", "config",
            "init", "list_devices", "complete",
        ];
        expect(Object.keys(COMMANDS).sort()).toEqual(expected.sort());
    });

    it("gives every supported command a non-empty argv", () => {
        for (const [key, entry] of Object.entries(COMMANDS)) {
            if (entry.supported) {
                expect(entry.argv.length, `${key} is supported but has no argv`).toBeGreaterThan(0);
            }
        }
    });

    it("resolves discovery keys to route words", () => {
        expect(resolve_route("create_node")).toEqual(["create", "node"]);
        expect(resolve_route("read_property")).toEqual(["read"]);
    });

    it("passes literal route words through so aa.bash can share the entrypoint", () => {
        expect(resolve_route("create")).toEqual(["create"]);
        expect(resolve_route("read")).toEqual(["read"]);
    });

    it("resolves no token to the top-level routes", () => {
        const absent: string | undefined = undefined;
        expect(resolve_route(absent)).toEqual([]);
        expect(resolve_route("")).toEqual([]);
    });

    it("resolves an unsupported key to undefined", () => {
        expect(resolve_route("create_property")).toBeUndefined();
    });
});
