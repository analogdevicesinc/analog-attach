import path from "node:path";

import { answer, command, type ListContextArguments } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { overlay_files } from "../../overlay-index";
import type { ListContextResponse, ListedDevicetree } from "../../protocol/descriptions";
import { find_architectures, find_dts_files } from "../../setup";

/** The base devicetrees of the Linux tree: every `.dts` under `arch/<arch>/boot/dts` but the overlays, by architecture and then name. */
export function base_devicetrees(linux: string, configured?: string): ListedDevicetree[] {
    const overlays = new Set(overlay_files(linux));
    return find_architectures(linux).flatMap(arch => {
        const root = path.join(linux, "arch", arch, "boot", "dts");
        return find_dts_files(linux, arch)
            .map(name => ({ path: path.join(root, name), arch, name }))
            .filter(entry => !overlays.has(path.relative(linux, entry.path)))
            .map(entry => (entry.path === configured ? { ...entry, configured: true as const } : entry));
    });
}

/** What `list context` prints: a path a line, the configured one marked, then the count and how to pick one. */
export function context_lines(devicetrees: readonly ListedDevicetree[], linux: string, program: string): string[] {
    return [
        ...devicetrees.map(entry => (entry.configured === true ? `${entry.path} (configured)` : entry.path)),
        ...(devicetrees.length > 0 ? [""] : []),
        `${devicetrees.length} devicetree${devicetrees.length === 1 ? "" : "s"} in ${linux}.`,
        `Use: ${program} config devicetree <path>`,
    ];
}

export const list_context = command<ListContextArguments, ListContextResponse>({
    docs: {
        brief: "List the base devicetrees of the Linux tree",
        full: `Every .dts under arch/<arch>/boot/dts of the Linux tree, the overlays left
out, by its absolute path: what 'config devicetree' takes. Needs only the
linux setting.`,
        examples: [
            "list context          The base devicetrees",
            "--json list context   As JSON",
        ],
    },
    run(_arguments, _flags, session) {
        const loaded = load_workspace(session, ["linux"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { linux, settings } = loaded.workspace;
        const devicetrees = base_devicetrees(linux, settings.devicetree);
        return Promise.resolve(answer<ListContextResponse>(
            { ok: true, message: `${devicetrees.length} devicetree${devicetrees.length === 1 ? "" : "s"}`, severity: "info", devicetrees },
            () => context_lines(devicetrees, linux, session.program).join("\n"),
        ));
    },
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const fs = await import("node:fs");
    const os = await import("node:os");

    test("base_devicetrees — every .dts of each architecture but the overlays, the configured one marked", () => {
        const linux = fs.mkdtempSync(path.join(os.tmpdir(), "context-"));
        try {
            for (const file of ["arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts", "arch/arm/boot/dts/overlays/ad7124-overlay.dts", "arch/arm64/boot/dts/broadcom/bcm2711-rpi-4-b.dts", "arch/arm64/boot/dts/broadcom/x.dtsi"]) {
                fs.mkdirSync(path.join(linux, path.dirname(file)), { recursive: true });
                fs.writeFileSync(path.join(linux, file), "");
            }
            const configured = path.join(linux, "arch/arm64/boot/dts/broadcom/bcm2711-rpi-4-b.dts");
            expect(base_devicetrees(linux, configured)).toEqual([
                { path: path.join(linux, "arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"), arch: "arm", name: "broadcom/bcm2711-rpi-4-b.dts" },
                { path: configured, arch: "arm64", name: "broadcom/bcm2711-rpi-4-b.dts", configured: true },
            ]);
        } finally {
            fs.rmSync(linux, { recursive: true, force: true });
        }
    });

    test("context_lines — the paths, the configured one marked, then the count and the Use line", () => {
        expect(context_lines([{ path: "/l/a.dts", arch: "arm", name: "a.dts" }, { path: "/l/b.dts", arch: "arm", name: "b.dts", configured: true }], "/l", "aa")).toEqual([
            "/l/a.dts",
            "/l/b.dts (configured)",
            "",
            "2 devicetrees in /l.",
            "Use: aa config devicetree <path>",
        ]);
        expect(context_lines([], "/l", "aa")).toEqual(["0 devicetrees in /l.", "Use: aa config devicetree <path>"]);
    });
}
