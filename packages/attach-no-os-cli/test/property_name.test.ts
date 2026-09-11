import { describe, expect, it } from "vitest";
import type { RulesetStruct } from "attach-no-os-lib";
import { resolve_property_name } from "../src/commands/shared";

/**
 * A node with just the property names, which is all resolution looks at.
 *
 * The types are the lib's, so a schema change that renames `properties` or `name` breaks
 * this at compile time rather than leaving a test that passes against nothing.
 */
function node(...names: string[]): RulesetStruct {
    return { properties: names.map(name => ({ name })) } as unknown as RulesetStruct;
}

describe("resolve_property_name", () => {
    it("supplies the $ a shell would have eaten", () => {
        expect(resolve_property_name(node("$init_param", "iio_dev"), "init_param")).toBe("$init_param");
    });

    it("leaves an already-canonical name alone", () => {
        expect(resolve_property_name(node("$init_param"), "$init_param")).toBe("$init_param");
    });

    it("does not touch a name that needs no prefix", () => {
        expect(resolve_property_name(node("device_id"), "device_id")).toBe("device_id");
    });

    it("prefers an exact match over the prefixed one", () => {
        // If a schema ever declares a real `init_param` field, typing it must reach that
        // field and not the reserved key next to it.
        expect(resolve_property_name(node("init_param", "$init_param"), "init_param")).toBe("init_param");
    });

    it("returns an unknown name as typed, so the caller reports what the user wrote", () => {
        expect(resolve_property_name(node("$init_param"), "nonesuch")).toBe("nonesuch");
    });
});
