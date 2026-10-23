import { NodeFixup } from "../FixupWalker.js";

/**
 * dt-schema: `fixups.py:fixup_schema` drops the parts of a schema file that validation doesn't
 * need (`maintainers`, ...). A binding that includes other schema files carries theirs too,
 * so this runs on every node schema. `$schema` and `select` go as well: neither means anything to AJV.
 */
export const fixup_remove_invalid_keys: NodeFixup = (schema) => {
    delete schema["$schema"];
    delete schema["maintainers"];
    delete schema["select"];
};

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test("a node schema loses what validation doesn't need; its properties are not touched", () => {
        const schema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties: { select: { description: "a property that happens to be named select" }, compatible: { enum: ["one"] } },
        };
        fixup_remove_invalid_keys(schema, []);
        expect(schema).toStrictEqual({
            $id: "test_id",
            title: "test_binding",
            properties: { select: { description: "a property that happens to be named select" }, compatible: { enum: ["one"] } },
        });
    });
}
