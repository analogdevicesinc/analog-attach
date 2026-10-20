// Whether an overlay is meant for the base's board: its root `compatible`
// against the base's root `compatible`. Some vendors write a generic SoC
// compatible meaning "any board in the family" (brcm,bcm2835 on almost every
// RPi overlay), so a family table loosens the match for those.

export type Fit = "compatible" | "incompatible" | "unknown";

export interface BoardFit {
    fit: Fit;
    /** Shown in brackets after the fit: what matched, or why not. */
    reason: string;
}

interface Family {
    name: string;
    /** Overlay compatibles that mean any board of the family. */
    generic: readonly string[];
    /** Base compatibles that belong to the family. */
    bases: readonly string[];
}

export const FAMILIES: readonly Family[] = [
    {
        name: "raspberrypi",
        generic: ["brcm,bcm2835", "brcm,bcm2708", "brcm,bcm2709", "brcm,bcm2836"],
        bases: ["brcm,bcm2835", "brcm,bcm2836", "brcm,bcm2837", "brcm,bcm2708", "brcm,bcm2709", "brcm,bcm2710", "brcm,bcm2711", "brcm,bcm2712"],
    },
];

/** How the overlay's root compatible (`undefined` when it has none) fits the base's. */
export function board_fit(overlay: readonly string[] | undefined, base: readonly string[]): BoardFit {
    if (overlay === undefined || overlay.length === 0) { return { fit: "unknown", reason: "no root compatible" }; }
    const exact = overlay.find(compatible => base.includes(compatible));
    if (exact !== undefined) { return { fit: "compatible", reason: exact }; }
    for (const compatible of overlay) {
        const family = FAMILIES.find(f => f.generic.includes(compatible) && base.some(b => f.bases.includes(b)));
        if (family !== undefined) { return { fit: "compatible", reason: `family: ${compatible} → ${family.name}` }; }
    }
    // A typo such as "bcrm, bcm2711" says nothing about the board.
    const malformed = overlay.find(compatible => !/^[a-z0-9-]+,[\w.+-]+$/i.test(compatible));
    if (malformed !== undefined) { return { fit: "unknown", reason: `root compatible "${malformed}" isn't vendor,name` }; }
    return { fit: "incompatible", reason: `overlay: ${overlay.join(", ")}; base: ${base.join(", ")}` };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const PI4 = ["raspberrypi,4-model-b", "brcm,bcm2711"];

    test("board_fit — an exact match", () => {
        expect(board_fit(["brcm,bcm2711"], PI4)).toEqual({ fit: "compatible", reason: "brcm,bcm2711" });
    });

    test("board_fit — a generic family compatible matches any board of the family", () => {
        expect(board_fit(["brcm,bcm2835"], PI4)).toEqual({ fit: "compatible", reason: "family: brcm,bcm2835 → raspberrypi" });
        expect(board_fit(["brcm,bcm2835", "brcm,bcm2708"], PI4)).toEqual({ fit: "compatible", reason: "family: brcm,bcm2835 → raspberrypi" });
    });

    test("board_fit — an exact match wins over the family", () => {
        expect(board_fit(["brcm,bcm2835"], ["raspberrypi,model-zero", "brcm,bcm2835"])).toEqual({ fit: "compatible", reason: "brcm,bcm2835" });
    });

    test("board_fit — another board of the family, or another vendor", () => {
        expect(board_fit(["brcm,bcm2712"], PI4))
            .toEqual({ fit: "incompatible", reason: "overlay: brcm,bcm2712; base: raspberrypi,4-model-b, brcm,bcm2711" });
        expect(board_fit(["xlnx,zynqmp"], PI4))
            .toEqual({ fit: "incompatible", reason: "overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711" });
        // A generic compatible on a base outside the family.
        expect(board_fit(["brcm,bcm2835"], ["xlnx,zynqmp"]))
            .toEqual({ fit: "incompatible", reason: "overlay: brcm,bcm2835; base: xlnx,zynqmp" });
    });

    test("board_fit — no root compatible, or one that isn't vendor,name", () => {
        expect(board_fit(undefined, PI4)).toEqual({ fit: "unknown", reason: "no root compatible" });
        expect(board_fit([], PI4)).toEqual({ fit: "unknown", reason: "no root compatible" });
        expect(board_fit(["bcrm, bcm2711"], PI4)).toEqual({ fit: "unknown", reason: 'root compatible "bcrm, bcm2711" isn\'t vendor,name' });
    });
}
