import { validateManifest, validateInput } from "./schema";
import { AnalogAttachError } from "./error";

function minimalManifest(): Record<string, unknown> {
    return {
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
    };
}

describe("validateManifest", () => {
    it("valid manifest passes", () => {
        expect(() => validateManifest(minimalManifest())).not.toThrow();
    });

    it("missing required command fails", () => {
        const m = minimalManifest();
        const commands = m["commands"] as Record<string, unknown>;
        delete commands["add"];
        expect(() => validateManifest(m)).toThrow(AnalogAttachError);
    });

    it("top-level required in args rejected", () => {
        const m = minimalManifest();
        const commands = m["commands"] as Record<string, Record<string, unknown>>;
        commands["add"]!["args"] = {
            properties: { bus_id: { type: "string" } },
            required: ["bus_id"],
        };
        try {
            validateManifest(m);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(AnalogAttachError);
            expect((error as AnalogAttachError).kind).toBe("manifest");
            expect((error as AnalogAttachError).message).toContain("top-level 'required'");
        }
    });

    it("unknown command name rejected", () => {
        const m = minimalManifest();
        const commands = m["commands"] as Record<string, unknown>;
        commands["bogus-command"] = { argv: ["tool", "bogus"] };
        expect(() => validateManifest(m)).toThrow(AnalogAttachError);
    });

    it("completion flag same as command name rejected", () => {
        const m = minimalManifest();
        const commands = m["commands"] as Record<string, Record<string, unknown>>;
        commands["add"] = {
            argv: ["tool", "add"],
            args: { properties: { add: { type: "string" } } },
        };
        try {
            validateManifest(m);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(AnalogAttachError);
            expect((error as AnalogAttachError).message).toContain("flag names must not equal their command name");
        }
    });

    it("manifest with args and completions passes", () => {
        const m = minimalManifest();
        const commands = m["commands"] as Record<string, Record<string, unknown>>;
        commands["add"] = {
            argv: ["tool", "add"],
            args: { properties: { bus_id: { type: "string" } } },
            timeout_ms: 5000,
            completions: [{ arg: "add", kind: "device-key" }],
        };
        expect(() => validateManifest(m)).not.toThrow();
    });
});

describe("validateInput", () => {
    it("passes with valid input", () => {
        const schema = {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
        };
        expect(() => validateInput(schema, { key: "foo" })).not.toThrow();
    });

    it("fails with missing required field", () => {
        const schema = {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
        };
        expect(() => validateInput(schema, {})).toThrow(AnalogAttachError);
    });
});
