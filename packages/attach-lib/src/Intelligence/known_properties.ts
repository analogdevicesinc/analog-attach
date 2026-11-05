import { ResolvedProperty } from "../Bindings/ParsedBinding.js";

export function insert_known_structures(properties: ResolvedProperty[]): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);

    for (const property of properties_clone) {

        if (property.value._t === 'node') {
            property.value.properties = insert_known_structures(property.value.properties);
            continue;
        }

        // iio.yaml's 9 items: dt-validate applies it to every node (`select: true`), the pipeline only to the ones that `$ref` it
        if (property.key === "mount-matrix") {
            property.value = {
                _t: "list", item: { _t: "string" }, minItems: 9, maxItems: 9,
                description: property.value.description,
            };
        }
    }

    return properties_clone;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const property = (key: string, value: ResolvedProperty["value"]): ResolvedProperty => ({ key, value });
    const run = (...properties: ResolvedProperty[]) => insert_known_structures(properties);

    test("mount-matrix becomes a 9-element string list", () => {
        const [result] = run(property("mount-matrix", { _t: "unknown", description: "e" }));
        expect(result!.value).toStrictEqual({
            _t: "list",
            item: { _t: "string" },
            minItems: 9,
            maxItems: 9,
            description: "e",
        });
    });

    test("node properties are recursed", () => {
        const [result] = run(property("port", {
            _t: "node",
            properties: [property("mount-matrix", { _t: "list", item: { _t: "string" } })],
        }));
        expect(result!.value._t).toBe("node");
        if (result!.value._t === "node") {
            expect(result!.value.properties[0]!.value).toMatchObject({ minItems: 9, maxItems: 9 });
        }
    });
}
