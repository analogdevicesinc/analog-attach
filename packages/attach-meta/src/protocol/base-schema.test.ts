import { baseSchema, effectiveSchema } from "./base-schema";
import { COMMAND_NAMES } from "./manifest";

describe("baseSchema", () => {
    it("add base schema requires key or name (anyOf with 2 branches)", () => {
        const s = baseSchema("add");
        const anyOf = (s as Record<string, unknown>)["anyOf"] as unknown[];
        expect(anyOf).toHaveLength(2);
    });

    it("each base schema has at most one x-positional", () => {
        for (const cmd of COMMAND_NAMES) {
            const schema = baseSchema(cmd);
            const properties = (schema as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined;
            if (!properties) {continue;}
            const count = Object.values(properties).filter(
                property => property["x-positional"] === true,
            ).length;
            expect(count).toBeLessThanOrEqual(1);
        }
    });

    it("all base schemas parse as valid JSON objects", () => {
        for (const cmd of COMMAND_NAMES) {
            const schema = baseSchema(cmd);
            expect(typeof schema).toBe("object");
            expect(schema).not.toBeNull();
        }
    });

    it("every command has a base schema with a type field", () => {
        for (const cmd of COMMAND_NAMES) {
            const schema = baseSchema(cmd);
            expect(schema).toHaveProperty("type");
        }
    });
});

describe("effectiveSchema", () => {
    it("merges allOf when tool args given", () => {
        const toolArguments = {
            properties: { bus_id: { type: "string" } },
        };
        const eff = effectiveSchema("add", toolArguments);
        const allOf = (eff as Record<string, unknown>)["allOf"] as unknown[];
        expect(allOf).toHaveLength(2);
    });

    it("returns base schema when no tool args", () => {
        const eff = effectiveSchema("add");
        expect(eff).not.toHaveProperty("allOf");
        expect(eff).toHaveProperty("type");
    });
});
