import { is_active, is_dt_flag, type DeviceTreeOverlay, type DTNode } from "linux-lib";

/** A device the overlay adds under a node that is off: Linux doesn't probe it. */
export interface DisabledParentWarning {
	/** Absolute path of the device. */
	path: string;
	message: string;
	hint: string;
}

/**
 * The nodes the overlay adds directly under a base node (its devices; their
 * children go with them) that are enabled while that node isn't (VALIDATE-130),
 * in tree order. The parent's status is the merged tree's: the base's, or the
 * overlay's when it sets one.
 */
export function disabled_parent_warnings(overlay: DeviceTreeOverlay): DisabledParentWarning[] {
	const base = overlay.get_base_dts();
	if (base === undefined) { return []; }
	const warnings: DisabledParentWarning[] = [];
	const walk = (path: string): void => {
		const parent = overlay.effective_node(path);
		for (const [name, child] of overlay.effective_children(path)) {
			const at = child_path(path, name);
			if (base.node_at(at) !== undefined) {
				walk(at);
			} else if (parent !== undefined && !is_active(parent) && is_active(child)) {
				const parent_name = path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
				warnings.push({
					path: at,
					message: `parent ${parent_name} is not enabled (status "${status_of(parent)}"): Linux won't probe ${name}`,
					hint: `Enable it: enable ${path}`,
				});
			}
		}
	};
	overlay.unchanged(() => walk("/"));
	return warnings;
}

function child_path(path: string, name: string): string {
	return path === "/" ? `/${name}` : `${path}/${name}`;
}

function status_of(node: DTNode): string {
	const status = node.properties.find(property => property.name === "status");
	if (status === undefined || is_dt_flag(status.value)) { return ""; }
	return status.value.map(value => value.kind === "string" ? value.value : "").join(", ");
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const { DeviceTree, DeviceTreeOverlay: DTO } = await import("linux-lib");

	const base_source = `/dts-v1/;
/ {
    #address-cells = <1>;
    #size-cells = <1>;
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 { reg = <0>; };
        };
        spi1: spi@7e215080 {
            #address-cells = <1>;
            #size-cells = <0>;
            status = "disabled";
        };
        i2c1: i2c@7e804000 {
            #address-cells = <1>;
            #size-cells = <0>;
            status = "okay";
        };
    };
};`;

	const setup = (overlay_source: string): DeviceTreeOverlay => {
		const base = DeviceTree.new_from_string(base_source);
		if (typeof base === "string") { throw new TypeError(base); }
		const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n${overlay_source}`, base);
		if (typeof overlay === "string") { throw new TypeError(overlay); }
		return overlay;
	};

	test("disabled_parent_warnings — a device on a bus the base disables", () => {
		expect(disabled_parent_warnings(setup("&spi1 {\n\tadc@0 { reg = <0>; channel@0 { reg = <0>; }; };\n};"))).toEqual([{
			path: "/soc/spi@7e215080/adc@0",
			message: `parent spi@7e215080 is not enabled (status "disabled"): Linux won't probe adc@0`,
			hint: "Enable it: enable /soc/spi@7e215080",
		}]);
	});

	test("disabled_parent_warnings — a device on a bus the overlay disables", () => {
		expect(disabled_parent_warnings(setup("&i2c1 {\n\tstatus = \"disabled\";\n\tadc@48 { reg = <0x48>; };\n};")).map(warning => warning.path))
			.toEqual(["/soc/i2c@7e804000/adc@48"]);
	});

	test("disabled_parent_warnings — none once the bus is on, or the device off too", () => {
		expect(disabled_parent_warnings(setup("&spi1 {\n\tstatus = \"okay\";\n\tadc@0 { reg = <0>; };\n};"))).toEqual([]);
		expect(disabled_parent_warnings(setup("&spi1 {\n\tadc@0 { reg = <0>; status = \"disabled\"; };\n};"))).toEqual([]);
		expect(disabled_parent_warnings(setup("&spi0 {\n\tadc@1 { reg = <1>; };\n};"))).toEqual([]);
	});

	test("disabled_parent_warnings — base nodes under a disabled bus aren't the overlay's", () => {
		expect(disabled_parent_warnings(setup("&spi0 {\n\tstatus = \"disabled\";\n};"))).toEqual([]);
	});
}
