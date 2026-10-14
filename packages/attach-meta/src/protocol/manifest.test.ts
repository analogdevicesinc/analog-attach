import { COMMAND_NAMES, REQUIRED_COMMANDS, parseManifest, getCommand } from "./manifest";
import type { CommandName } from "./manifest";

describe("CommandName", () => {
    it("has 17 command names", () => {
        expect(COMMAND_NAMES).toHaveLength(17);
    });

    it("every name is a unique string", () => {
        const set = new Set(COMMAND_NAMES);
        expect(set.size).toBe(COMMAND_NAMES.length);
    });

    it("required commands are a subset of all commands", () => {
        for (const request of REQUIRED_COMMANDS) {
            expect(COMMAND_NAMES).toContain(request);
        }
    });

    it("has 9 required commands", () => {
        expect(REQUIRED_COMMANDS).toHaveLength(9);
    });
});

describe("parseManifest", () => {
    it("parses minimal manifest", () => {
        const json = JSON.stringify({
            protocol_version: "1.0.0",
            commands: {
                add: { argv: ["tool", "add"] },
                read: { argv: ["tool", "read"] },
                update: { argv: ["tool", "update"] },
                delete: { argv: ["tool", "delete"] },
                validate: { argv: ["tool", "validate"] },
                "tool-config-get": { argv: ["tool", "config-get"] },
                "tool-config-set": { argv: ["tool", "config-set"] },
                "create-workfile": { argv: ["tool", "workfile"] },
                "list-devices": { argv: ["tool", "devices"] },
            },
        });
        const m = parseManifest(json);
        expect(m.protocol_version).toBe("1.0.0");
        expect(getCommand(m, "add")).toBeDefined();
        expect(getCommand(m, "move")).toBeUndefined();
    });

    it("parses manifest with args and completions", () => {
        const json = JSON.stringify({
            protocol_version: "1.0.0",
            commands: {
                add: {
                    argv: ["tool", "add"],
                    args: { properties: { bus_id: { type: "string" } } },
                    timeout_ms: 5000,
                    completions: [
                        { arg: "add", kind: "device-key" },
                        { arg: "bus_id", kind: "bus-id" },
                    ],
                },
                read: { argv: ["tool", "read"] },
                update: { argv: ["tool", "update"] },
                delete: { argv: ["tool", "delete"] },
                validate: { argv: ["tool", "validate"] },
                "tool-config-get": { argv: ["tool", "config-get"] },
                "tool-config-set": { argv: ["tool", "config-set"] },
                "create-workfile": { argv: ["tool", "workfile"] },
                "list-devices": { argv: ["tool", "devices"] },
            },
        });
        const m = parseManifest(json);
        const add = getCommand(m, "add")!;
        expect(add.timeout_ms).toBe(5000);
        expect(add.args).toBeDefined();
        expect(add.completions).toHaveLength(2);
        expect(add.completions![0]!.kind).toBe("device-key");
    });

    it("throws on invalid JSON", () => {
        expect(() => parseManifest("not json")).toThrow("failed to parse manifest");
    });
});
