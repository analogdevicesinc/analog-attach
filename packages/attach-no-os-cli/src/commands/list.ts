import { buildCommand, buildRouteMap } from "@stricli/core";
import {
    Board,
    boards_for_platform,
    get_setting_value,
    platform_for_board,
    scan_boards,
    PlatformSpecs,
} from "attach-no-os-lib";
import {
    get_platform_specs,
    output,
    output_error,
} from "./shared";

/*
 * Read-only inventory of what the tool can target. It exists because the two halves of
 * that answer live in different repositories - boards come from no-OS's CMake presets
 * and platforms from the schema tree - and neither list is any use on its own: a board
 * with no schemas cannot be generated for, and a platform with no boards cannot be
 * built.
 */

type ListedBoard = {
    name: string;
    platform?: string;
    vendor: string;
    chip?: string;
    description?: string;
};

type ListedBoards = { generatable: ListedBoard[], unsupported: ListedBoard[] };

function describe_boards(boards: Board[], specs: PlatformSpecs): ListedBoards {
    const listed = boards.map(board => ({
        name: board.name,
        platform: platform_for_board(board, specs),
        vendor: board.vendor,
        chip: board.chip,
        description: board.description,
    }));

    return {
        generatable: listed.filter(b => b.platform !== undefined),
        unsupported: listed.filter(b => b.platform === undefined),
    };
}

const listBoardsCommand = buildCommand<{ json?: boolean }, []>({
    docs: { brief: "List the no-OS boards that can be generated for" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const noos_path = get_setting_value("no_os_path");
        if (!noos_path.ok) {
            output_error(flags, "config_missing", "no_os_path is not configured. Run: aa config no_os_path <path>");
            return;
        }

        const specs = get_platform_specs();
        if (!specs.ok) {
            output_error(flags, "cannot_list_platforms", specs.error.message);
            return;
        }

        const boards = scan_boards(noos_path.value);
        if (!boards.ok) {
            output_error(flags, "cannot_list_boards", boards.error.message);
            return;
        }

        const data = describe_boards(boards.value, specs.value);

        // Grouped by platform rather than listed flat: the platform is what a board
        // gives you, and seeing two boards under one platform is also the warning that
        // `aa generate` will ask which one.
        const by_platform = new Map<string, ListedBoard[]>();
        for (const board of data.generatable) {
            const key = board.platform ?? "";
            by_platform.set(key, [...by_platform.get(key) ?? [], board]);
        }

        let text = "";
        for (const platform of [...by_platform.keys()].sort()) {
            const group = by_platform.get(platform) ?? [];
            text += `  ${platform}\n`;
            for (const board of group) {
                text += `      ${board.name}\n`;
            }
            text += "\n";
        }

        if (data.unsupported.length > 0) {
            text += "  no schemas - cannot generate\n";
            for (const board of data.unsupported) {
                text += `      ${board.name} (${board.chip ?? board.vendor})\n`;
            }
            text += "\n";
        }

        text += `${data.generatable.length} of ${data.generatable.length + data.unsupported.length} boards can be generated for.\n`;
        text += "Use: aa create workfile --board <name>";

        output(flags, text, data);
    }
});

type ListedPlatform = {
    name: string;
    vendor: string;
    description?: string;
    boards: string[];
};

function describe_platforms(specs: PlatformSpecs, noos_path?: string): ListedPlatform[] {
    return Object.entries(specs).map(([name, manifest]) => {
        // A platform with no boards is not broken: linux and mbed do not build through
        // a board preset at all, and max32662 has schemas ahead of any board. They are
        // exactly the platforms --platform exists for, so the count is worth showing.
        const boards = noos_path === undefined ? undefined : boards_for_platform(noos_path, name, specs);
        return {
            name: name,
            vendor: manifest.vendor,
            description: manifest.description,
            boards: boards?.ok === true ? boards.value.map(b => b.name) : [],
        };
    });
}

const listPlatformsCommand = buildCommand<{ json?: boolean }, []>({
    docs: { brief: "List the schema platforms and their boards" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const specs = get_platform_specs();
        if (!specs.ok) {
            output_error(flags, "cannot_list_platforms", specs.error.message);
            return;
        }

        // Boards are a nicety here, so a missing no_os_path degrades to platforms only
        // rather than failing: the platform list comes from the schemas alone.
        const noos_path = get_setting_value("no_os_path");
        const platforms = describe_platforms(specs.value, noos_path.ok ? noos_path.value : undefined);

        let text = "";
        for (const platform of platforms) {
            text += `  ${platform.name} (${platform.vendor})\n`;
            if (platform.boards.length > 0) {
                text += `      boards: ${platform.boards.join(", ")}\n`;
            } else if (noos_path.ok) {
                text += "      boards: none - build it with --platform\n";
            }
            text += "\n";
        }
        text += `${platforms.length} platforms`;
        if (!noos_path.ok) {
            text += "\n\nno_os_path is not configured, so boards are not shown.";
        }

        output(flags, text, { platforms });
    }
});

export const listCommand = buildRouteMap({
    routes: {
        boards: listBoardsCommand,
        platforms: listPlatformsCommand,
    },
    docs: { brief: "List the boards and platforms this tool can target" }
});
