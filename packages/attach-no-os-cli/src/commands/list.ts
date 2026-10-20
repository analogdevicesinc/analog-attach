import { buildCommand } from "@stricli/core";
import {
    BoardInfo,
    list_boards,
    list_socs,
} from "attach-no-os-lib";
import {
    output,
    output_error,
} from "./shared";
import { common_ok } from "../protocol/responses";

/*
 * Read-only inventory of what the tool can target.
 *
 * Both halves now come from the same place: a platform module declares the chips it
 * supports and the boards it supports, and each board module names the chip it carries. So
 * there is no such thing as a board the tool cannot generate for, and no
 * generatable/unsupported split to report.
 */

type ListedBoard = {
    name: string;
    /** The chip the board carries, which is what the `platform` setting names. */
    platform?: string;
    vendor?: string;
    description?: string;
};

function describe_boards(boards: BoardInfo[]): ListedBoard[] {
    return boards.map(board => ({
        name: board.name,
        platform: board.soc,
        vendor: board.vendor,
        description: board.description,
    }));
}

export const listBoardsCommand = buildCommand<{ json?: boolean }, []>({
    docs: { brief: "List the boards that can be generated for" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const boards = list_boards();
        if (!boards.ok) {
            output_error(flags, boards.error.message);
            return;
        }

        const listed = describe_boards(boards.value);

        // Grouped by chip rather than listed flat: the chip is what a board settles, and
        // seeing two boards under one chip is also the warning that `attach-noos generate`
        // will ask which one.
        const by_platform = new Map<string, ListedBoard[]>();
        for (const board of listed) {
            const key = board.platform ?? "unknown";
            by_platform.set(key, [...by_platform.get(key) ?? [], board]);
        }

        let text = "";
        for (const platform of [...by_platform.keys()].sort()) {
            text += `  ${platform}\n`;
            for (const board of by_platform.get(platform) ?? []) {
                text += `      ${board.name}\n`;
            }
            text += "\n";
        }

        text += `${listed.length} board${listed.length === 1 ? "" : "s"} available.\n`;
        text += "Use: attach-noos config board <name>, then attach-noos init";

        const message = `${listed.length} board${listed.length === 1 ? "" : "s"} available`;
        output(flags, text, { ...common_ok(message), boards: listed });
    }
});

type ListedPlatform = {
    name: string;
    vendor: string;
    description?: string;
    boards: string[];
};

function describe_platforms(): ListedPlatform[] {
    const socs = list_socs();
    if (!socs.ok) {
        return [];
    }

    const boards = list_boards();
    const all_boards = boards.ok ? boards.value : [];

    return socs.value.map(({ soc, platform }) => ({
        name: soc.name,
        vendor: platform.vendor ?? platform.name,
        description: soc.cpu,
        // A chip with no board is not broken: it is exactly what the `platform` setting
        // exists for, so the count is worth showing.
        boards: all_boards.filter(board => board.soc === soc.name).map(board => board.name),
    }));
}

export const listPlatformsCommand = buildCommand<{ json?: boolean }, []>({
    docs: { brief: "List the schema platforms and their boards" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const platforms = describe_platforms();

        let text = "";
        for (const platform of platforms) {
            text += `  ${platform.name} (${platform.vendor})\n`;
            text += platform.boards.length > 0
                ? `      boards: ${platform.boards.join(", ")}\n`
                : "      boards: none - target it with the 'platform' setting\n";
            text += "\n";
        }
        text += `${platforms.length} chips`;

        output(flags, text, { ...common_ok(`${platforms.length} platform${platforms.length === 1 ? "" : "s"}`), platforms });
    }
});
