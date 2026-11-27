import { DeviceTree, DeviceTreeOverlay, is_active, is_dt_flag, PropertyBuilder, type DTNode } from "linux-lib";

import { answer, input_error, refuse, type ExtraCommand } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { positional_word, resolve_path } from "../../utilities";
import type { CommonResponse } from "../../protocol/types";

/** `enable <path>` / `disable <path>`: the node's status in the overlay. */
function status_command(name: "enable" | "disable", status_value: "okay" | "disabled", verb: string): ExtraCommand<Record<never, never>, CommonResponse> {
	return {
		docs: {
			brief: `${verb} a node (status = "${status_value}")`,
			full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

A status the node has without the overlay's own (the base's; enabled for a node
the overlay adds) isn't written: the overlay's status is removed instead.`,
			examples: [`${name} spi0`, `${name} spi0/spidev@0`],
		},
		positionals: [
			{ name: "path", placeholder: "path", brief: "Path to node (label, label-first, or absolute)", optional: true, slot: prior => ({ kind: "extra", command: name, id: "path", prior }) },
		],
		group: "edit",
		schema: "enable-disable.schema.json",
		async run(arguments_, _flags, session) {
			const path_argument = positional_word(arguments_, "path");
			if (path_argument === undefined) { return input_error("Missing: path"); }

			const loaded = load_workspace(session, ["base", "overlay"]);
			if (!loaded.ok) { return loaded.outcome; }
			const { workspace } = loaded;
			const { source: devicetree, tree: base } = workspace.base;
			const { path: input, tree: overlay } = workspace.overlay;

			const result = set_node_status(base, overlay, path_argument, status_value);
			if (result === "not-found") {
				const response = status_response(result, verb, path_argument);
				return refuse(response.message, { type: "not-found", text: `Couldn't find node ${path_argument} in ${devicetree} or ${input}` });
			}
			if (result.changed) { workspace.overlay.save(); }
			return answer(status_response(result, verb, path_argument), status_text(result, verb, path_argument, input));
		},
	};
}

/**
 * What `set_node_status` did: `written` the status (ENABLE-011), or left it `unwritten` as the
 * one the node has without the overlay's own, as the base has it or as the overlay adds the node
 * (ENABLE-012), removing the overlay's (`changed` when it had one).
 */
export type StatusResult =
	| { kind: "written"; changed: true }
	| { kind: "unwritten"; as: "base" | "added"; changed: boolean };

/** Why the status isn't written and what was done instead, naming `file` in human mode. */
function unwritten_note(result: Extract<StatusResult, { kind: "unwritten" }>, file: string | undefined): string {
	const why = result.as === "base" ? "as in the base" : "as the overlay adds it";
	const what = result.changed
		? `status removed${file === undefined ? "" : ` from ${file}`}`
		: `nothing to change${file === undefined ? "" : ` in ${file}`}`;
	return `${why}: ${what}`;
}

export function status_response(result: StatusResult | "not-found", verb: string, identifier: string): CommonResponse {
	if (result === "not-found") {
		return { ok: false, message: `Not found: ${identifier}`, severity: "error", error_type: "not-found" };
	}
	const note = result.kind === "unwritten" ? ` (${unwritten_note(result, undefined)})` : "";
	return { ok: true, message: `${verb}d ${identifier}${note}`, severity: "info" };
}

/** The human line of a success (ENABLE-013). */
export function status_text(result: StatusResult, verb: string, identifier: string, file: string): string {
	return result.kind === "written"
		? `${verb}d ${identifier} in ${file}`
		: `${verb}d ${identifier} (${unwritten_note(result, file)})`;
}

export const enable = status_command("enable", "okay", "Enable");
export const disable = status_command("disable", "disabled", "Disable");

/**
 * Whether the node has `status` without the overlay's: `node` is the base's, undefined for a node
 * the overlay adds, which is enabled. Enabled is no status, `okay` or `ok` (`is_active`, as
 * VALIDATE-130 has it); disabled is the string `disabled` alone.
 */
function has_status(node: DTNode | undefined, status: "okay" | "disabled"): boolean {
	if (node === undefined) { return status === "okay"; }
	if (status === "okay") { return is_active(node); }
	const property = node.properties.find(p => p.name === "status");
	if (property === undefined || is_dt_flag(property.value) || property.value.length !== 1) { return false; }
	const [value] = property.value;
	return value?.kind === "string" && value.value === "disabled";
}

export function set_node_status(
	base: DeviceTree,
	overlay: DeviceTreeOverlay,
	identifier: string,
	status: "okay" | "disabled",
): StatusResult | "not-found" {

	const resolved = resolve_path(identifier, overlay, base);
	const path = resolved.in_overlay?.node_path ?? resolved.in_base?.path;
	if (path === undefined) { return "not-found"; }

	// Already the node's status without the overlay's: the overlay's goes, from every fragment
	// that sets one, and a fragment left empty goes with it (the lib's remove_property).
	const base_node = base.node_at(path);
	if (has_status(base_node, status)) {
		const changed = overlay.property_node(path, "status") !== undefined
			&& overlay.remove_property({ kind: "path", labels: [], path }, "status");
		return { kind: "unwritten", as: base_node === undefined ? "added" : "base", changed };
	}

	// The fragment whose status applies (a later one's wins, as in dtc), else the first, or a new one
	const node = overlay.property_node(path, "status") ?? overlay.ensure_node(path);
	if (node === undefined) { return "not-found"; }

	const status_property = PropertyBuilder.build_string()
		.with_value(status)
		.with_name("status")
		.build();
	const index = node.properties.findIndex(p => p.name === "status");
	if (index === -1) {
		node.properties.push(status_property);
	} else {
		node.properties[index] = status_property;
	}
	return { kind: "written", changed: true };
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	// spi0 off, spi1 with no status (on), uart0 "ok" (on), i2c0 "fail" (neither).
	const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            status = "disabled";
        };
        spi1: spi@7e215080 {
        };
        uart0: serial@7e201000 {
            status = "ok";
        };
        i2c0: i2c@7e205000 {
            status = "fail";
        };
    };
};`;
	const SPI0 = "/soc/spi@7e204000";
	const SPI1 = "/soc/spi@7e215080";

	const parse = (overlay_dts: string): { base: DeviceTree; overlay: DeviceTreeOverlay } => {
		const base = DeviceTree.new_from_string(base_dts);
		if (typeof base === "string") { throw new TypeError(base); }
		const overlay = DeviceTreeOverlay.new_from_string(overlay_dts, base);
		if (typeof overlay === "string") { throw new TypeError(overlay); }
		return { base, overlay };
	};
	const status_of = (overlay: DeviceTreeOverlay, path: string): unknown =>
		overlay.overlay_properties(path).find(p => p.name === "status")?.value;
	const string_value = (value: string): unknown =>
		PropertyBuilder.build_string().with_value(value).with_name("status").build().value;

	const empty = `/dts-v1/;\n/plugin/;\n/ {\n};\n`;
	const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

	test("set_node_status - enable of a node the base disables writes okay, in the fragment for it", () => {
		const { base, overlay } = parse(overlay_with_imu);
		expect(set_node_status(base, overlay, "spi0", "okay")).toEqual({ kind: "written", changed: true });
		expect(overlay.get_fragments()).toHaveLength(1);
		expect(status_of(overlay, SPI0)).toEqual(string_value("okay"));
	});

	test("set_node_status - disable of a node with no status in the base writes disabled, in a new fragment", () => {
		const { base, overlay } = parse(overlay_with_imu);
		expect(set_node_status(base, overlay, "spi1", "disabled")).toEqual({ kind: "written", changed: true });
		expect(overlay.get_fragments()).toHaveLength(2);
		expect(status_of(overlay, SPI1)).toEqual(string_value("disabled"));
	});

	test("set_node_status - writes into the fragment whose status applies", () => {
		const { base, overlay } = parse(`/dts-v1/;\n/plugin/;\n\n&spi1 {\n};\n\n&spi1 {\n    status = "okay";\n};\n`);
		expect(set_node_status(base, overlay, "spi1", "disabled")).toEqual({ kind: "written", changed: true });
		const [first, second] = overlay.overlay_nodes_at(SPI1);
		expect(first?.properties.map(p => p.name)).toEqual([]);
		expect(second?.properties.map(p => p.name)).toEqual(["status"]);
		expect(status_of(overlay, SPI1)).toEqual(string_value("disabled"));
	});

	test("set_node_status - a status that is the base's isn't written; with none in the overlay nothing changes", () => {
		const { base, overlay } = parse(overlay_with_imu);
		const before = overlay.print();
		expect(set_node_status(base, overlay, "spi0", "disabled")).toEqual({ kind: "unwritten", as: "base", changed: false });
		expect(set_node_status(base, overlay, "spi1", "okay")).toEqual({ kind: "unwritten", as: "base", changed: false });
		expect(overlay.print()).toBe(before);
	});

	test("set_node_status - a status that is the base's removes the overlay's, and the rest of its block stays", () => {
		const { base, overlay } = parse(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n    status = "okay";\n    #address-cells = <1>;\n    adc@0 {\n        reg = <0>;\n    };\n};\n`);
		expect(set_node_status(base, overlay, "spi0", "disabled")).toEqual({ kind: "unwritten", as: "base", changed: true });
		const [node] = overlay.overlay_nodes_at(SPI0);
		expect(node?.properties.map(p => p.name)).toEqual(["#address-cells"]);
		expect(node?.children.map(child => child.name)).toEqual(["adc"]);
	});

	test("set_node_status - removes the status from every fragment that sets one, and linux-lib prunes a fragment left empty", () => {
		const { base, overlay } = parse(`/dts-v1/;\n/plugin/;\n\n&spi1 {\n    status = "disabled";\n};\n\n&spi0 {\n    status = "okay";\n};\n\n&spi1 {\n    status = "disabled";\n};\n`);
		expect(set_node_status(base, overlay, "spi1", "okay")).toEqual({ kind: "unwritten", as: "base", changed: true });
		expect(overlay.overlay_nodes_at(SPI1)).toEqual([]);
		expect(overlay.get_fragments()).toHaveLength(1);
		expect(status_of(overlay, SPI0)).toEqual(string_value("okay"));
	});

	test("set_node_status - ok in the base is enabled; a status other than disabled isn't disabled", () => {
		const { base, overlay } = parse(empty);
		expect(set_node_status(base, overlay, "uart0", "okay")).toEqual({ kind: "unwritten", as: "base", changed: false });
		expect(set_node_status(base, overlay, "i2c0", "disabled")).toEqual({ kind: "written", changed: true });
		expect(set_node_status(base, overlay, "i2c0", "okay")).toEqual({ kind: "written", changed: true });
	});

	test("set_node_status - a node the overlay adds is enabled without a status", () => {
		const { base, overlay } = parse(overlay_with_imu);
		const IMU = `${SPI0}/adi,ad7124-8@0`;
		expect(set_node_status(base, overlay, "imu1", "okay")).toEqual({ kind: "unwritten", as: "added", changed: false });
		expect(set_node_status(base, overlay, "imu1", "disabled")).toEqual({ kind: "written", changed: true });
		expect(status_of(overlay, IMU)).toEqual(string_value("disabled"));
		expect(set_node_status(base, overlay, "imu1", "okay")).toEqual({ kind: "unwritten", as: "added", changed: true });
		expect(status_of(overlay, IMU)).toBeUndefined();
		// The node stays, with what else it has.
		expect(overlay.find_node(IMU)?.node.properties.map(p => p.name)).toEqual(["compatible"]);
	});

	test("set_node_status - returns not-found for unknown node", () => {
		const { base, overlay } = parse(overlay_with_imu);
		expect(set_node_status(base, overlay, "nonexistent", "okay")).toBe("not-found");
	});

	test("status_response / status_text - the JSON and the human line of each outcome", () => {
		const written = { kind: "written", changed: true } as const;
		const removed = { kind: "unwritten", as: "base", changed: true } as const;
		const nothing = { kind: "unwritten", as: "base", changed: false } as const;
		const added = { kind: "unwritten", as: "added", changed: true } as const;
		expect(status_response(written, "Disable", "spi0/spidev@0"))
			.toEqual({ ok: true, message: "Disabled spi0/spidev@0", severity: "info" });
		expect(status_response(removed, "Disable", "spi0").message).toBe("Disabled spi0 (as in the base: status removed)");
		expect(status_response(nothing, "Enable", "spi1").message).toBe("Enabled spi1 (as in the base: nothing to change)");
		expect(status_response(added, "Enable", "imu1").message).toBe("Enabled imu1 (as the overlay adds it: status removed)");
		expect(status_response("not-found", "Enable", "nope"))
			.toEqual({ ok: false, message: "Not found: nope", severity: "error", error_type: "not-found" });
		expect(status_text(written, "Disable", "spi0/spidev@0", "/w/o.dtso")).toBe("Disabled spi0/spidev@0 in /w/o.dtso");
		expect(status_text(removed, "Disable", "spi0", "/w/o.dtso")).toBe("Disabled spi0 (as in the base: status removed from /w/o.dtso)");
		expect(status_text(nothing, "Enable", "spi1", "/w/o.dtso")).toBe("Enabled spi1 (as in the base: nothing to change in /w/o.dtso)");
		expect(status_text(added, "Enable", "imu1", "/w/o.dtso")).toBe("Enabled imu1 (as the overlay adds it: status removed from /w/o.dtso)");
	});
}
