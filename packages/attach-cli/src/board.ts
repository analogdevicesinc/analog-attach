import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse_board_description, type BoardDescription } from "attach-lib";

import { getBundledBoardsPath } from "./commands/skill/utilities";

/** Names of the board descriptions shipped in bundled/boards/. */
export function list_bundled_boards(bundled_directory = getBundledBoardsPath()): string[] {
    if (!fs.existsSync(bundled_directory)) { return []; }
    return fs.readdirSync(bundled_directory)
        .filter(file => file.endsWith(".yaml"))
        .map(file => file.slice(0, -".yaml".length))
        .sort();
}

/**
 * The `board` config value is either a path to a board description or the
 * name of a bundled one. An existing path wins; otherwise the name is looked
 * up in bundled/boards/<name>.yaml. Returns undefined when neither exists.
 */
export function resolve_board_reference(reference: string, bundled_directory = getBundledBoardsPath()): string | undefined {
    if (fs.existsSync(reference) && fs.statSync(reference).isFile()) { return reference; }
    const bundled = path.join(bundled_directory, `${reference}.yaml`);
    return fs.existsSync(bundled) ? bundled : undefined;
}

/**
 * Absolute path of the overlay a board ships for its onboard devices (its
 * `overlay` field is relative to the board file). Undefined when the board
 * has none or the reference doesn't resolve.
 */
export function resolve_board_overlay(reference: string, board: BoardDescription, bundled_directory = getBundledBoardsPath()): string | undefined {
    if (board.overlay === undefined) { return; }
    const board_path = resolve_board_reference(reference, bundled_directory);
    return board_path === undefined ? undefined : path.resolve(path.dirname(board_path), board.overlay);
}

/** Resolve and parse a board reference, returning the description or an error string. */
export function load_board(reference: string, bundled_directory = getBundledBoardsPath()): BoardDescription | string {
    let board_path: string | undefined;
    try {
        board_path = resolve_board_reference(reference, bundled_directory);
    } catch (error) {
        return `cannot read ${reference}: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (board_path === undefined) {
        const bundled = list_bundled_boards(bundled_directory);
        return `no board file at ${reference} and no bundled board of that name (bundled: ${bundled.length > 0 ? bundled.join(", ") : "none"})`;
    }
    try {
        const board = parse_board_description(fs.readFileSync(board_path, "utf8"));
        return typeof board === "string" ? `${board_path}: ${board}` : board;
    } catch (error) {
        return `cannot read ${board_path}: ${error instanceof Error ? error.message : String(error)}`;
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    // Tests run from src/, where getBundledBoardsPath's dist-relative resolution does not apply.
    const bundled_directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bundled", "boards");

    test("list_bundled_boards — lists the shipped boards by name", () => {
        expect(list_bundled_boards(bundled_directory)).toContain("pmd-rpi-intz");
    });

    test("load_board — resolves a bundled name", () => {
        const board = load_board("pmd-rpi-intz", bundled_directory);
        if (typeof board === "string") { throw new TypeError(board); }
        expect(board.board).toBe("PMD-RPI-INTZ");
        expect(board.slots.map(slot => slot.id)).toStrictEqual(["spi_pmod1", "spi_pmod2", "i2c_pmod1", "i2c_pmod2", "quikeval", "psm"]);
    });

    test("resolve_board_overlay — resolves relative to the board file; undefined without an overlay", () => {
        const board = load_board("adalm-lsmspg", bundled_directory);
        if (typeof board === "string") { throw new TypeError(board); }
        const overlay = resolve_board_overlay("adalm-lsmspg", board, bundled_directory);
        expect(overlay).toBe(path.resolve(bundled_directory, "..", "overlays", "rpi-adalm-lsmspg-overlay.dts"));
        expect(fs.existsSync(overlay!)).toBe(true);

        const without = load_board("pmd-rpi-intz", bundled_directory);
        if (typeof without === "string") { throw new TypeError(without); }
        expect(resolve_board_overlay("pmd-rpi-intz", without, bundled_directory)).toBeUndefined();
    });

    test("load_board — resolves a path", () => {
        const board = load_board(path.join(bundled_directory, "pmd-rpi-intz.yaml"), bundled_directory);
        expect(typeof board).toBe("object");
    });

    test("load_board — reports unknown references and schema errors", () => {
        expect(load_board("no-such-board", bundled_directory)).toMatch(/^no board file at no-such-board and no bundled board of that name \(bundled: .*pmd-rpi-intz/);

        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-board-"));
        try {
            const broken = path.join(directory, "broken.yaml");
            fs.writeFileSync(broken, "schema_version: 4\nboard: X\ngpio_controller: \"&gpio\"\nbuses: {}\nslots: {a: {bus: spi0}}\n");
            expect(load_board(broken, bundled_directory)).toBe(`${broken}: slots.a.bus: spi0 is not a key in buses`);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test.skipIf(process.getuid?.() === 0)("load_board — returns an error string for unreadable files", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-board-"));
        try {
            const unreadable = path.join(directory, "unreadable.yaml");
            fs.writeFileSync(unreadable, "board: X\n");
            fs.chmodSync(unreadable, 0o000);
            expect(load_board(unreadable, bundled_directory)).toMatch(/^cannot read .*: .*EACCES/);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
