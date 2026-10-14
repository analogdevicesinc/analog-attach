import { parseCommandArguments } from "./dynargs";
import type { CommandMapping } from "./protocol/manifest";
import { AnalogAttachError } from "./error";

function mapping(arguments_?: Record<string, unknown>): CommandMapping {
    return {
        argv: ["tool", "add"],
        args: arguments_,
        timeout_ms: undefined,
        completions: undefined,
    };
}

describe("parseCommandArguments", () => {
    it("parses add key as positional", () => {
        const parsed = parseCommandArguments("add", mapping(), ["my_device"]);
        expect(parsed.positionals).toEqual(["my_device"]);
        expect(parsed.flagsJson).not.toHaveProperty("key");
    });

    it("parses positionals and bool flag", () => {
        const parsed = parseCommandArguments("delete", mapping(), ["soc", "spi", "--force"]);
        expect(parsed.positionals).toEqual(["soc", "spi"]);
        expect(parsed.flagsJson["force"]).toBe(true);
    });

    it("parses standalone bool flag", () => {
        const parsed = parseCommandArguments("delete", mapping(), ["--force"]);
        expect(parsed.flagsJson["force"]).toBe(true);
    });

    it("rejects tool arg collision with base", () => {
        const toolArguments = {
            properties: { key: { type: "string" } },
        };
        expect(() =>
            parseCommandArguments("add", mapping(toolArguments), []),
        ).toThrow(AnalogAttachError);
        try {
            parseCommandArguments("add", mapping(toolArguments), []);
        } catch (error) {
            expect((error as AnalogAttachError).kind).toBe("manifest");
        }
    });

    it("parses tool-declared extra flag", () => {
        const toolArguments = {
            properties: { bus_id: { type: "string" } },
        };
        const parsed = parseCommandArguments("add", mapping(toolArguments), ["k", "--bus_id", "b1"]);
        expect(parsed.positionals).toEqual(["k"]);
        expect(parsed.flagsJson["bus_id"]).toBe("b1");
    });
});
