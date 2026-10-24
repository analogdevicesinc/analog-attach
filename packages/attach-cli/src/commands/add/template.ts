// What `add --template` starts the node from: the interview over the binding's
// required properties, a node copied from one of the binding's examples, or the
// node of a Linux-tree overlay.

export type Template =
    | { kind: "required" }
    | { kind: "example"; index: number }
    | { kind: "overlay"; name: string };

export const TEMPLATE_FORMS = "required, example:<N> or overlay:<name>";

/** The template as the command line writes it (`required`, `example:2`, `overlay:name`); the error text when it isn't one. */
export function parse_template(text: string): Template | string {
    if (text === "required") { return { kind: "required" }; }
    const colon = text.indexOf(":");
    const kind = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? undefined : text.slice(colon + 1);
    if (kind === "example") {
        if (value === undefined) { return "--template example needs the example's number: example:<N> (the position in the binding's examples)"; }
        if (!/^[1-9]\d*$/.test(value)) { return `--template ${text}: the example number must be a positive integer (example:1, example:2, ...)`; }
        return { kind: "example", index: Number(value) };
    }
    if (kind === "overlay") {
        if (value === undefined || value === "") { return "--template overlay needs an overlay: overlay:<name> (a name from 'list overlay <compatible>', or a file path)"; }
        return { kind: "overlay", name: value };
    }
    return `Unknown --template ${text} (use ${TEMPLATE_FORMS})`;
}

/** The template as the response reports it. */
export function template_text(template: Template): string {
    switch (template.kind) {
        case "required": { return "required"; }
        case "example": { return `example:${template.index}`; }
        case "overlay": { return `overlay:${template.name}`; }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("parse_template — the three kinds", () => {
        expect(parse_template("required")).toEqual({ kind: "required" });
        expect(parse_template("example:2")).toEqual({ kind: "example", index: 2 });
        expect(parse_template("example:12")).toEqual({ kind: "example", index: 12 });
        expect(parse_template("overlay:rpi-ad7124-8-all-diff")).toEqual({ kind: "overlay", name: "rpi-ad7124-8-all-diff" });
        expect(parse_template("overlay:./dir:with/colon.dts")).toEqual({ kind: "overlay", name: "./dir:with/colon.dts" });
    });

    test("parse_template — bad kinds and numbers are errors", () => {
        for (const bad of ["example", "example:", "example:0", "example:x", "example:-1", "example:1.5", "example:01", "overlay", "overlay:", "foo", "foo:1", "", "Required", "required:1"]) {
            expect(typeof parse_template(bad), bad).toBe("string");
        }
        expect(parse_template("example")).toContain("example:<N>");
        expect(parse_template("foo:1")).toBe("Unknown --template foo:1 (use required, example:<N> or overlay:<name>)");
    });

    test("template_text — what the response reports", () => {
        expect(["required", "example:3", "overlay:x"].map(text => template_text(parse_template(text) as Template))).toEqual(["required", "example:3", "overlay:x"]);
    });
}
