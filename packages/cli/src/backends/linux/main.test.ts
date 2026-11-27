// The Linux backend through the front end's `main`, in the tiny workspace of
// testing/fixture.ts.

import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Registry } from "../../front/registry";
import { build_routes, type FrontEnd } from "../../front/routes";
import { create_setup } from "./commands/setup/command";
import { backend } from "./index";
import { BASE_DTS, create_linux_fixture, IMPORTED, OVERLAY, scripted, type LinuxFixture, type RunOptions, type RunResult } from "./testing/fixture";

/** The fixture's base with a second, empty SPI bus. */
const BASE_WITH_SPI1 = BASE_DTS.replace("\t};\n};\n", "\t\tspi1: spi@7e215080 {\n\t\t\tcompatible = \"brcm,bcm2835-aux-spi\";\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t};\n\t};\n};\n");

/** An RPi overlay of the Linux tree that adds an ad7124-8. */
const OVERLAY_FILE = `/dts-v1/;
/plugin/;
/ {
\tcompatible = "brcm,bcm2835";
\tfragment@0 {
\t\ttarget = <&spi0>;
\t\t__overlay__ {
\t\t\tadc@0 {
\t\t\t\tcompatible = "adi,ad7124-8";
\t\t\t\treg = <0>;
\t\t\t};
\t\t};
\t};
};
`;

let fixture: LinuxFixture;
let base: string;
let project: string;
let linux: string;

const write_settings = (values: Record<string, string>): void => { fixture.write_settings(values); };
const write_caches = (): void => { fixture.write_caches(); };
const configure = (): void => { fixture.configure(); };
const run = (argv: readonly string[], options: RunOptions = {}): Promise<RunResult> => fixture.run(argv, options);

/** The standard output of a run. */
async function stdout_of(argv: readonly string[], options: RunOptions = {}): Promise<string> {
	const result = await run(argv, options);
	return result.stdout;
}

/** The response of a run in JSON mode (`--json` put first). */
async function json_of(argv: readonly string[], options: RunOptions = {}): Promise<unknown> {
	return JSON.parse(await stdout_of(["--json", ...argv], options)) as unknown;
}

beforeEach(() => {
	fixture = create_linux_fixture();
	({ base, project, linux } = fixture);
});

afterEach(() => {
	fixture.remove();
});

describe("the Linux backend through main", () => {
	test("--json read: the node as the base and the overlay have it, each value with its source", async () => {
		write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso") });
		const result = await run(["--json", "read", "spi0"]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			kind: "node",
			key: "spi@7e204000",
			origin: "internal",
			alias: ["spi0"],
			properties: [
				{ key: "compatible", source: "base" },
				{ key: "#address-cells", source: "base" },
				{ key: "#size-cells", source: "base" },
				{ key: "status", source: "overlay", value: "okay" },
			],
			children: [{ key: "adc@0", origin: "internal" }],
		});

		const text = await run(["read", "spi0", "status"]);
		expect(text).toEqual({ code: 0, stdout: `status = "okay";\n`, stderr: "" });

		// The whole overlay: the same nodes, where they go, with only what the overlay sets (READ-011).
		const whole = await run(["--json", "read"]);
		expect(JSON.parse(whole.stdout)).toMatchObject({ key: "/", origin: "external", properties: [], children: [{ key: "soc", origin: "external", properties: [], children: [{
			key: "spi@7e204000",
			origin: "internal",
			properties: [{ key: "status", source: "overlay", value: "okay" }],
			children: [{ key: "adc@0", origin: "internal" }],
		}] }] });
	});

	test("--json read of a property: what its binding says of it, which --quiet leaves out", async () => {
		configure();
		const read_json = async (argv: readonly string[]): Promise<Record<string, unknown>> => {
			const result = await run(["--json", "read", ...argv]);
			return JSON.parse(result.stdout) as Record<string, unknown>;
		};
		const reg = await read_json(["adc", "reg"]);
		expect(reg).toMatchObject({ key: "reg", source: "overlay", required: true, definition: "adi,ad7124.yaml" });
		expect(reg).not.toHaveProperty("constraints");
		// The binding's type; the single cell as written becomes a one-item array of it.
		expect(reg).toMatchObject({ type: { kind: "array", items: { kind: "number" } }, value: [0], written: ["0"] });

		await run(["update", "adc", "spi-max-frequency", "1000000"]);
		expect(await read_json(["adc", "spi-max-frequency"])).toMatchObject({ required: false, constraints: { maximum: 5_000_000 }, definition: "adi,ad7124.yaml" });

		const quiet = await read_json(["--quiet", "adc", "reg"]);
		for (const key of ["required", "constraints", "definition", "description"]) { expect(quiet).not.toHaveProperty(key); }
		// --quiet reads no binding: the type is the value's.
		expect(quiet).toMatchObject({ type: { kind: "number" }, value: 0 });
	});

	test("--json read: each number also as written, in the nesting of the value (READ-054); none without a number", async () => {
		configure();
		await run(["update", "adc", "spi-max-frequency", "0x4c4b40"]);
		await run(["update", "adc", "interrupts", "25", "0x2"]);
		const property = await json_of(["read", "adc", "spi-max-frequency"]);
		expect(property).toMatchObject({ value: 5_000_000, written: "0x4c4b40" });
		const node = await json_of(["read", "adc"]) as { properties: Record<string, unknown>[] };
		const by_key = new Map(node.properties.map(entry => [entry["key"], entry]));
		expect(by_key.get("reg")).toMatchObject({ value: 0, written: "0" });
		expect(by_key.get("interrupts")).toMatchObject({ value: [25, 2], written: ["25", "0x2"] });
		expect(by_key.get("compatible")).not.toHaveProperty("written");
		// The base's numbers as its parse gives them.
		const bus = await json_of(["read", "spi0"]) as { properties: Record<string, unknown>[] };
		expect(bus.properties.find(entry => entry["key"] === "#size-cells")).toMatchObject({ source: "base", value: 0, written: "0" });
	});

	test("a refused rename: exit 0, the reason on stdout, ok: false under --json; the workfile is unchanged", async () => {
		write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso") });
		const text = await run(["rename", "spi0", "spi1"]);
		expect(text.code).toBe(0);
		expect(text.stdout).toContain("spi0 is part of the base device tree");
		const json = await run(["--json", "rename", "/", "top"]);
		expect(json.code).toBe(0);
		expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, severity: "error" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);

		const renamed = await run(["--json", "rename", "adc", "adc@1"]);
		expect(JSON.parse(renamed.stdout)).toMatchObject({ ok: true, message: "Renamed adc to adc@1; reg first cell set to 0x1" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adc: adc@1 {");
	});

	test("init creates the configured workfile, then keeps it", async () => {
		const workfile = path.join(project, "new.dtso");
		write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile });
		write_caches();
		const first = await run(["--json", "init"]);
		expect(first.code).toBe(0);
		expect(first.stderr).toBe("");
		expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, path: workfile, overlay: workfile, created: true, linux, devicetree: path.join(base, "base.dts") });
		expect(fs.readFileSync(workfile, "utf8")).toContain("/plugin/;");

		const second = await run(["init"]);
		expect(second.code).toBe(0);
		expect(second.stdout).toContain(`Overlay:       ${workfile} (kept)`);
		expect(second.stdout).toContain("analog-attach list devices [filter]");
	});

	test("a workspace that isn't configured: a refusal with the setup hint, under --json too, with its errors and hints", async () => {
		write_settings({});
		const text = await run(["read", "spi0"]);
		expect(text.code).toBe(0);
		expect(text.stdout).toContain("Missing config field devicetree");
		expect(text.stdout).toContain("Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then 'analog-attach init', to set up a workspace.");
		const json = await run(["--json", "read", "spi0"]);
		expect(json).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(json.stdout)).toMatchObject({
			ok: false,
			message: "Missing config field devicetree; Missing config field linux; Missing config field workfile",
			severity: "error",
			errors: [{ field: "devicetree" }, { field: "linux" }, { field: "workfile" }],
			hints: [expect.stringContaining("'analog-attach config linux <path>'")],
		});
	});
	test("--json list devices: the compatibles that contain the filter, with their category; the one it names described", async () => {
		configure();
		const named = await run(["--json", "list", "devices", "adi,ad7124-8"]);
		expect(named.code).toBe(0);
		expect(JSON.parse(named.stdout)).toMatchObject({
			ok: true,
			message: "Device adi,ad7124-8",
			devices: [{ key: "adi,ad7124-8", tag: "iio/adc" }],
			names: ["adi,ad7124-8"],
			device: {
				key: "adi,ad7124-8",
				compatible: "adi,ad7124-8",
				title: "Analog Devices AD7124 ADC",
				binding: path.join(linux, "Documentation", "devicetree", "bindings", "iio", "adc", "adi,ad7124.yaml"),
				children: [{ name: "channel@N" }],
			},
		});

		const both = await run(["--json", "list", "devices", "ad7124"]);
		const response = JSON.parse(both.stdout) as Record<string, unknown>;
		expect(response).toMatchObject({ message: "Found 2 devices", devices: [{ key: "adi,ad7124-4", tag: "iio/adc" }, { key: "adi,ad7124-8", tag: "iio/adc" }] });
		expect(response).not.toHaveProperty("device");
		expect(await run(["list", "devices", "ad7124"])).toEqual({ code: 0, stdout: "adi,ad7124-4  iio/adc\nadi,ad7124-8  iio/adc\n", stderr: "" });
	});

	test("list context: the base devicetrees of the Linux tree, the overlays left out, the configured one marked; only linux is needed", async () => {
		const dts = path.join(linux, "arch", "arm", "boot", "dts");
		for (const file of ["broadcom/bcm2711-rpi-4-b.dts", "overlays/ad7124-overlay.dts"]) {
			fs.mkdirSync(path.join(dts, path.dirname(file)), { recursive: true });
			fs.writeFileSync(path.join(dts, file), "");
		}
		const rpi = path.join(dts, "broadcom", "bcm2711-rpi-4-b.dts");
		fixture.write_settings({ linux, devicetree: rpi });
		const listed = await run(["--json", "list", "context"]);
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true, message: "1 devicetree", severity: "info", devicetrees: [{ path: rpi, arch: "arm", name: "broadcom/bcm2711-rpi-4-b.dts", configured: true }],
		});
		expect(await run(["list", "context"])).toEqual({
			code: 0, stdout: `${rpi} (configured)\n\n1 devicetree in ${linux}.\nUse: analog-attach config devicetree <path>\n`, stderr: "",
		});
	});

	test("list context <filter>: only the devicetrees whose path in the tree contains it; none is no refusal", async () => {
		for (const file of ["arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts", "arm64/boot/dts/broadcom/bcm2711-rpi-4-b.dts", "arm/boot/dts/xilinx/zynq-zc702.dts"]) {
			fs.mkdirSync(path.join(linux, "arch", path.dirname(file)), { recursive: true });
			fs.writeFileSync(path.join(linux, "arch", file), "");
		}
		fixture.write_settings({ linux });
		const names = async (...filter: string[]) => {
			const listed = await run(["--json", "list", "context", ...filter]);
			return (JSON.parse(listed.stdout) as { devicetrees: { arch: string; name: string }[] }).devicetrees.map(entry => `${entry.arch}:${entry.name}`);
		};
		expect(await names("rpi-4")).toEqual(["arm:broadcom/bcm2711-rpi-4-b.dts", "arm64:broadcom/bcm2711-rpi-4-b.dts"]);
		expect(await names("arm64/")).toEqual(["arm64:broadcom/bcm2711-rpi-4-b.dts"]);
		const none = await run(["--json", "list", "context", "RPI"]);
		expect(JSON.parse(none.stdout)).toMatchObject({ ok: true, message: "0 devicetrees", devicetrees: [] });
		expect(await run(["list", "context", "zynq"])).toEqual({
			code: 0, stdout: `${path.join(linux, "arch/arm/boot/dts/xilinx/zynq-zc702.dts")}\n\n1 devicetree in ${linux}.\nUse: analog-attach config devicetree <path>\n`, stderr: "",
		});
	});

	test("--json list property: a node's properties marked set and required, with their types; one property's type; the overlay's nodes", async () => {
		configure();
		const names = await run(["--json", "list", "property", "adc"]);
		expect(names.code).toBe(0);
		const response = JSON.parse(names.stdout) as { names: string[]; suggestions: { value: string; display_string?: string }[] };
		expect(response.names).toEqual(expect.arrayContaining(["compatible", "reg", "spi-max-frequency", "^channel@([0-9]|1[0-5])$"]));
		expect(response.suggestions).toContainEqual({ value: "reg", display_string: "reg (set, required)" });

		const reg = await run(["--json", "list", "property", "adc", "reg"]);
		expect(JSON.parse(reg.stdout)).toMatchObject({ ok: true, message: "Type of reg", property: { name: "reg", required: true, set: true } });

		expect(JSON.parse(names.stdout)).toMatchObject({ properties: expect.arrayContaining([expect.objectContaining({ name: "reg", type: expect.objectContaining({ kind: "array" }), display: "number[1]", required: true, set: true })]) });

		const nodes = await run(["--json", "list", "property"]);
		expect(nodes.code).toBe(0);
		expect(JSON.parse(nodes.stdout)).toMatchObject({ ok: true, message: expect.stringMatching(/^[0-9]+ nodes?$/), names: expect.arrayContaining(["adc"]) });
	});

	test("update --suggest: what list value answers, nothing written; a value is a member, an input error", async () => {
		configure();
		const before = fs.readFileSync(path.join(project, "overlay.dtso"), "utf8");
		const suggested = await run(["--json", "update", "adc", "spi-max-frequency", "--suggest"]);
		expect(suggested.code).toBe(0);
		expect(suggested).toEqual(await run(["--json", "list", "value", "adc", "spi-max-frequency"]));
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(before);
		expect(await run(["update", "adc", "spi-max-frequency", "1", "--suggest"])).toEqual({
			code: 2, stdout: "", stderr: "A member is not supported by the linux backend: 1\n",
		});
	});

	test("list value of a supply: a regulator can be added instead, in both modes; other properties have none", async () => {
		configure();
		const json = await run(["--json", "list", "value", "adc", "vref-supply"]);
		expect(json.code).toBe(0);
		expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, can_create: [{ value: "regulator-fixed", display_string: "add regulator-fixed" }] });
		const text = await run(["list", "value", "adc", "vref-supply"]);
		expect(text.stdout.trimEnd().split("\n").at(-1)).toBe("Or add your own: analog-attach add regulator-fixed");
		const none = await run(["--json", "list", "value", "adc", "spi-max-frequency"]);
		expect(JSON.parse(none.stdout)).not.toHaveProperty("can_create");
	});

	test("--json update: a value written answers ok, its message and severity alone (UPDATE-100); a warning on stderr makes the response a warn", async () => {
		configure();
		const set = await run(["--json", "update", "adc", "spi-max-frequency", "1000000"]);
		expect(set.code).toBe(0);
		expect(JSON.parse(set.stdout)).toEqual({ ok: true, message: "Set spi-max-frequency on adc", severity: "info" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("spi-max-frequency = <1000000>;");

		const warned = await run(["--json", "update", "adc", "interrupts", "25", "8"]);
		expect(warned.code).toBe(0);
		expect(JSON.parse(warned.stdout)).toMatchObject({ ok: true, message: "Set interrupts on adc", severity: "warn" });
		expect(warned.stderr).toContain("No interrupt-parent inherited for /soc/spi@7e204000/adc@0");

		const read = await run(["update", "adc", "spi-max-frequency", "--quiet"]);
		expect(read).toEqual({ code: 0, stdout: "spi-max-frequency = <1000000>;\n", stderr: "" });
	});

	test("update <path> <child>: the child created, its missing required properties listed", async () => {
		configure();
		const json = await run(["--json", "update", "adc", "channel@0"]);
		expect(json.code).toBe(0);
		expect(JSON.parse(json.stdout)).toMatchObject({
			ok: true,
			message: "Added channel@0 to adc",
			path: ["soc", "spi@7e204000", "adc@0", "channel@0"],
			missing_required: [{ property: "diff-channels" }],
		});
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("channel@0 {");

		const text = await run(["update", "adc", "channel@1"]);
		expect(text.stdout).toContain("Added channel@1 to adc");
		expect(text.stdout).toContain("Set them with: update adc/channel@1 <property> <value>");

		const refused = await run(["--json", "update", "adc", "channel@0", "1"]);
		expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, message: "channel@0 is a child node; set its properties with `update adc/channel@0 <prop> <value>`" });
	});

	test("import: a new workfile from an overlay file, now the configured one; the unresolved reference a warning", async () => {
		configure();
		fs.writeFileSync(path.join(project, "extra-overlay.dts"), IMPORTED);
		const result = await run(["--json", "import", "extra-overlay.dts"]);
		expect(result.code).toBe(0);
		const workfile = path.join(project, "extra.dtso");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			severity: "warn",
			path: workfile,
			source: path.join(project, "extra-overlay.dts"),
			replaced: path.join(project, "overlay.dtso"),
			unresolved: [{ path: ["soc", "spi@7e204000", "dac@1"], property: "vref-supply", reference: "&vref" }],
		});
		expect(result.stderr).toContain("vref-supply → &vref");
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toMatchObject({ backend: "linux", linux: { workfile } });

		const read = await run(["read", "--quiet", "spi0/dac@1", "reg"]);
		expect(read).toEqual({ code: 0, stdout: "reg = <1>;\n", stderr: "" });
	});

	test("--json add: the node under the first SPI bus, with its unit address and label; missing_required built for the response", async () => {
		configure();
		const result = await run(["--json", "add", "adi,adxl000"]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			message: "Added adi,adxl000@1 (label: adxl000)",
			key: "adi,adxl000@1",
			path: ["soc", "spi@7e204000", "adi,adxl000@1"],
			template: "required",
			missing_required: [{ property: "adi,mode", suggestions: [{ value: "fast" }, { value: "slow" }] }, { property: "spi-max-frequency" }],
		});
		expect(result.stderr).toBe("Parent: spi0 (use --parent to choose another)\nPicked chip select 1 (taken: 0 by adc@0).\nTo change it: rename adxl000 adi,adxl000@<n>\n");
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adxl000: adi,adxl000@1 {\n\t\t\t\tcompatible = \"adi,adxl000\";\n\t\t\t\treg = <0x1>;\n\t\t\t};");

		const duplicate = await run(["--json", "add", "adi,ad7124-4", "--parent", "spi0", "--name", "adc@0"]);
		expect(JSON.parse(duplicate.stdout)).toMatchObject({ ok: false });
	});

	test("delete of a referenced node previews the references; --force clears them", async () => {
		configure();
		const workfile = path.join(project, "overlay.dtso");
		fs.writeFileSync(workfile, OVERLAY.replace("\t\treg = <0>;\n", "\t\treg = <0>;\n\t\trefin1-supply = <&vref>;\n")
			+ "\n&{/} {\n\tvref: vref {\n\t\tcompatible = \"regulator-fixed\";\n\t};\n};\n");
		const before = fs.readFileSync(workfile, "utf8");

		const preview = await run(["--json", "delete", "vref"]);
		expect(JSON.parse(preview.stdout)).toEqual({
			ok: true,
			message: "'vref' is referenced by 1 property; deleting it would clear that reference. Re-run with --force.",
			severity: "warn",
			error_type: "needs-force",
			node_count: 1,
			property_count: 1,
			paths: [["vref"], ["adc", "refin1-supply"]],
		});
		const text = await run(["delete", "vref"]);
		expect(text.stdout).toBe("vref: referenced by\n\n  adc refin1-supply\n\nNothing was changed. Re-run with --force to delete the node and clear those references.\n");
		expect(fs.readFileSync(workfile, "utf8")).toBe(before);

		const forced = await run(["--json", "delete", "vref", "--force"]);
		expect(JSON.parse(forced.stdout)).toEqual({ ok: true, message: "Deleted vref and cleared 1 reference to it", severity: "info" });
		const after = fs.readFileSync(workfile, "utf8");
		expect(after).not.toContain("vref");
		expect(after).toContain("adc: adc@0");
	});

	test("move refuses a parent the binding doesn't allow, naming the ones it does", async () => {
		configure();
		fs.writeFileSync(path.join(base, "base.dts"), BASE_WITH_SPI1);
		const workfile = path.join(project, "overlay.dtso");
		const before = fs.readFileSync(workfile, "utf8");

		const refused = await run(["--json", "move", "adc", "/soc"]);
		expect(refused.code).toBe(0);
		expect(JSON.parse(refused.stdout)).toEqual({
			ok: false,
			message: "Cannot move adc under /soc: adi,ad7124-8 goes under spi0, spi1 (see: analog-attach list parent adi,ad7124-8)",
			severity: "error",
			error_type: "edit-refused",
		});
		expect(fs.readFileSync(workfile, "utf8")).toBe(before);

		const moved = await run(["--json", "move", "adc", "spi1"]);
		expect(JSON.parse(moved.stdout)).toMatchObject({ ok: true });
	});

	test("add off a terminal: nothing asked, the missing required properties listed", async () => {
		configure();
		const result = await run(["add", "adi,adxl000"]);
		expect(result).toEqual({
			code: 0,
			stdout: [
				`Added adi,adxl000@1 (label: adxl000) to ${path.join(project, "overlay.dtso")}`,
				"Missing required: adi,mode, spi-max-frequency",
				"Set them with: update adxl000 <property> <value>",
				"",
			].join("\n"),
			stderr: "Parent: spi0 (use --parent to choose another)\nPicked chip select 1 (taken: 0 by adc@0).\nTo change it: rename adxl000 adi,adxl000@<n>\n",
		});
	});

	test("add on a terminal: the parent question, then the interview, through the prompter", async () => {
		configure();
		const prompter = scripted(["", "b", "1000000"]);
		const result = await run(["add", "adi,adxl000"], { prompter });
		expect(result.code).toBe(0);
		expect(prompter.asked).toEqual(["parent [a]", "adi,mode [a]", "spi-max-frequency"]);
		expect(result.stdout).toContain("Where does adi,adxl000 go? (Enter takes a, a letter picks, or type a label or path, Ctrl-D stops)\n  a) spi0  /soc/spi@7e204000\n");
		expect(result.stdout).toContain(`Added adi,adxl000@1 (label: adxl000) to ${path.join(project, "overlay.dtso")}\n\n2 required properties to set`);
		expect(result.stdout).toMatch(/Set spi-max-frequency on adxl000\n\nAll required properties are set\.\n$/);
		expect(result.stderr).not.toContain("Parent:");
		const written = fs.readFileSync(path.join(project, "overlay.dtso"), "utf8");
		expect(written).toContain("adi,mode = \"slow\";");
		expect(written).toContain("spi-max-frequency = <1000000>;");
	});

	test("add on a terminal: Ctrl-C in the interview keeps the node and lists what is missing, exit 0", async () => {
		configure();
		const prompter = scripted(["", "a"]);
		const result = await run(["add", "adi,adxl000"], { prompter });
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/Missing required: spi-max-frequency\nSet them with: update adxl000 <property> <value>\n$/);
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adi,mode = \"fast\";");
	});

	test("add and update <path> <child> on a terminal with interview false: nothing asked, as off a terminal", async () => {
		configure();
		write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso"), interview: "false" });
		const prompter = scripted([]);
		const added = await run(["add", "adi,adxl000"], { prompter });
		expect(prompter.asked).toEqual([]);
		expect(added.code).toBe(0);
		expect(added.stdout).toContain("Missing required: adi,mode, spi-max-frequency\n");
		expect(added.stderr).toContain("Parent: spi0 (use --parent to choose another)\n");
		const child = await run(["update", "adc", "channel@0"], { prompter });
		expect(prompter.asked).toEqual([]);
		expect(child.stdout).toMatch(/^Added channel@0 to adc\nMissing required: diff-channels\n/);
	});

	test("update <path> <child> on a terminal: the child's missing required properties asked", async () => {
		configure();
		const prompter = scripted(["0 1"]);
		const result = await run(["update", "adc", "channel@0"], { prompter });
		expect(result.code).toBe(0);
		expect(prompter.asked).toEqual(["diff-channels"]);
		expect(result.stdout).toMatch(/^Added channel@0 to adc\n\n1 required property to set/);
		expect(result.stdout).toMatch(/All required properties are set\.\n$/);
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("diff-channels = <0 1>;");
	});

	test("add on a terminal: Ctrl-C at the parent question adds nothing, exit 130", async () => {
		configure();
		const prompter = scripted([]);
		const result = await run(["add", "adi,adxl000"], { prompter });
		expect(result.code).toBe(130);
		expect(result.stdout).toMatch(/No parent chosen; nothing added\.\n$/);
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);
	});

	test("--json move: the node under its new parent; a refusal keeps the workfile", async () => {
		configure();
		fs.writeFileSync(path.join(base, "base.dts"), BASE_WITH_SPI1);
		const into_self = await run(["--json", "move", "adc", "adc"]);
		expect(into_self.code).toBe(0);
		expect(JSON.parse(into_self.stdout)).toEqual({ ok: false, message: "Cannot move adc into itself or one of its descendants", severity: "error", error_type: "edit-refused" });
		const nowhere = await run(["--json", "move", "adc", "i2c9"]);
		expect(JSON.parse(nowhere.stdout)).toEqual({ ok: false, message: "Parent node i2c9 not found", severity: "error", error_type: "not-found" });
		expect(await run(["move", "adc", "i2c9"])).toMatchObject({ stdout: `Couldn't find parent node i2c9 in ${path.join(base, "base.dts")} or ${path.join(project, "overlay.dtso")}\n` });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);

		const moved = await run(["--json", "move", "adc", "spi1"]);
		expect(moved).toEqual({ code: 0, stdout: `${JSON.stringify({ ok: true, message: "Moved adc to spi1", severity: "info" })}\n`, stderr: "" });
		const written = fs.readFileSync(path.join(project, "overlay.dtso"), "utf8");
		expect(written).toMatch(/target = <&spi1>;\n\t\t__overlay__ \{\n\t\t\tadc: adc@0 \{/);
		expect(await run(["move", "adc", "spi0"])).toMatchObject({ stdout: `Moved adc to spi0 in ${path.join(project, "overlay.dtso")}\n` });
	});

	test("--json enable / disable: the status written, a base node gets a fragment, the base's status removed; an unknown node refused", async () => {
		configure();
		fs.writeFileSync(path.join(base, "base.dts"), BASE_WITH_SPI1);
		const disabled_spi1 = await run(["--json", "disable", "spi1"]);
		expect(JSON.parse(disabled_spi1.stdout)).toEqual({ ok: true, message: "Disabled spi1", severity: "info" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toMatch(/target = <&spi1>;\n\t\t__overlay__ \{\n\t\t\tstatus = "disabled";/);
		// spi1 has no status in the base, so it is enabled: the overlay's status goes, and its fragment with it.
		const enabled = await run(["--json", "enable", "spi1"]);
		expect(JSON.parse(enabled.stdout)).toEqual({ ok: true, message: "Enabled spi1 (as in the base: status removed)", severity: "info" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).not.toContain("&spi1");
		const disabled = await run(["disable", "adc"]);
		expect(disabled).toEqual({ code: 0, stdout: `Disabled adc in ${path.join(project, "overlay.dtso")}\n`, stderr: "" });
		expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toMatch(/adc: adc@0 \{\n(.*\n)*\t{4}status = "disabled";/);

		const missing = await run(["--json", "enable", "nope"]);
		expect(JSON.parse(missing.stdout)).toEqual({ ok: false, message: "Not found: nope", severity: "error", error_type: "not-found" });
		expect(await run(["--json", "enable"])).toMatchObject({ code: 2, stdout: "", stderr: "Missing: path\n" });
	});

	test("--json list parent: the valid buses of the base, label and path; no binding a warning", async () => {
		configure();
		const parents = await run(["--json", "list", "parent", "adi,ad7124-8"]);
		expect(parents.code).toBe(0);
		expect(JSON.parse(parents.stdout)).toEqual({
			ok: true, message: "Found 1 valid parents", severity: "info",
			suggestions: [{ value: "spi0", display_string: "/soc/spi@7e204000" }],
		});
		expect(await run(["list", "parent", "adi,ad7124-8"])).toMatchObject({ stdout: "spi0  /soc/spi@7e204000\n" });
		const unknown = await run(["--json", "list", "parent", "adi,nope"]);
		expect(JSON.parse(unknown.stdout)).toEqual({ ok: true, message: "Unknown compatible 'adi,nope'. See: analog-attach list devices", severity: "warn", error_type: "unknown-device-type", suggestions: [] });
		const close = await run(["--json", "add", "adi,ad7124-9"]);
		expect(JSON.parse(close.stdout)).toEqual({
			ok: false,
			message: "Unknown compatible 'adi,ad7124-9'. Did you mean adi,ad7124-4, adi,ad7124-8? See: analog-attach list devices",
			severity: "error",
			error_type: "unknown-device-type",
		});
	});

	test("--json list overlay: the overlays of the tree with the device, graded against the board", async () => {
		configure();
		const overlays = path.join(linux, "arch", "arm", "boot", "dts", "overlays");
		fs.mkdirSync(overlays, { recursive: true });
		fs.writeFileSync(path.join(overlays, "ad7124-overlay.dts"), OVERLAY_FILE);
		const listed = await run(["--json", "list", "overlay", "adi,ad7124-8"]);
		expect(listed.code).toBe(0);
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true, message: "1 overlays with adi,ad7124-8", severity: "info",
			overlays: [{ name: "ad7124-overlay.dts", path: path.join(overlays, "ad7124-overlay.dts"), devices: ["adi,ad7124-8"], fit: "incompatible", reason: "overlay: brcm,bcm2835; base: " }],
		});
		expect(await run(["list", "overlay", "adi,ad7124-8"])).toMatchObject({ stdout: "ad7124-overlay.dts  incompatible (overlay: brcm,bcm2835; base: )\n" });
		expect(await run(["list", "overlay", "adi,adxl000"])).toMatchObject({ stdout: `No overlay in ${linux} has adi,adxl000\n` });
	});

	test("list node: every node of the merged tree, what the overlay does to each; a filter on name, label or compatible", async () => {
		configure();
		const listed = await run(["--json", "list", "node"]);
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true, message: "4 nodes", severity: "info",
			nodes: [
				{ path: "/", key: "/", labels: [], compatible: [], origin: "external", change: "none", has_children: true },
				{ path: "/soc", key: "soc", labels: [], compatible: [], origin: "external", change: "none", has_children: true },
				{ path: "/soc/spi@7e204000", key: "spi@7e204000", labels: ["spi0"], compatible: ["brcm,bcm2835-spi"], status: "okay", origin: "internal", change: "changed", has_children: true },
				{ path: "/soc/spi@7e204000/adc@0", key: "adc@0", labels: ["adc"], compatible: ["adi,ad7124-8"], origin: "internal", change: "added", has_children: false },
			],
		});
		const by_compatible = await run(["--json", "list", "node", "BCM2835"]);
		expect(JSON.parse(by_compatible.stdout)).toMatchObject({ message: "1 node matches \"BCM2835\"", nodes: [{ path: "/soc/spi@7e204000" }] });
		expect(await run(["list", "node", "&adc"])).toEqual({
			code: 0, stdout: "/soc/spi@7e204000/adc@0  &adc  adi,ad7124-8  (new)\n\n1 node matches \"&adc\".\nUse: analog-attach read <path>\n", stderr: "",
		});
		expect(await run(["list", "node", "nothing"])).toEqual({ code: 0, stdout: "0 nodes match \"nothing\".\nUse: analog-attach read <path>\n", stderr: "" });
	});

	test("list overlay without a compatible: every overlay of the tree, with what it adds", async () => {
		configure();
		expect(await run(["list", "overlay"])).toMatchObject({ code: 0, stdout: `No overlay in ${linux}\n` });
		const overlays = path.join(linux, "arch", "arm", "boot", "dts", "overlays");
		fs.mkdirSync(overlays, { recursive: true });
		fs.writeFileSync(path.join(overlays, "ad7124-overlay.dts"), OVERLAY_FILE);
		fs.writeFileSync(path.join(overlays, "disable-bt-overlay.dts"), "/dts-v1/;\n/plugin/;\n/ {\n};\n");
		const listed = await run(["--json", "list", "overlay"]);
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true, message: "2 overlays", severity: "info",
			overlays: [
				{ name: "disable-bt-overlay.dts", path: path.join(overlays, "disable-bt-overlay.dts"), devices: [], fit: "unknown", reason: "no root compatible" },
				{ name: "ad7124-overlay.dts", path: path.join(overlays, "ad7124-overlay.dts"), devices: ["adi,ad7124-8"], fit: "incompatible", reason: "overlay: brcm,bcm2835; base: " },
			],
		});
		const text = await run(["list", "overlay"]);
		expect(text.stdout).toBe("disable-bt-overlay.dts  unknown (no root compatible)\nad7124-overlay.dts      incompatible (overlay: brcm,bcm2835; base: )  adds adi,ad7124-8\n");
	});

	test("the bare run: the backend's setup asks the tree, the base and the workfile's name, then init creates it", async () => {
		write_settings({});
		write_caches();
		const prompter = scripted([linux, "manual", path.join(base, "base.dts"), "board"]);
		const setup_registry: Registry = { linux: () => import("./index").then(module => ({ ...module.backend, setup: create_setup({ home: base }) })) };
		const result = await run([], { prompter, registry: setup_registry });
		expect(result.code).toBe(0);
		expect(prompter.asked).toEqual(["Linux source tree", "Choose how to select the base .dts file", "Path to .dts file", "Overlay file name"]);
		expect(result.stdout).toContain(`✓ linux = ${linux}\n`);
		expect(result.stdout).toContain(`✓ workfile = ${path.join(project, "board.dtso")}\n`);
		expect(result.stdout).toContain(`Overlay:       ${path.join(project, "board.dtso")} (created)`);
		expect(result.stdout).not.toContain("Create the workfile:");
		expect(fs.readFileSync(path.join(project, "board.dtso"), "utf8")).toContain("/plugin/;");
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toEqual({
			backend: "linux", linux: {
				linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "board.dtso"),
				// init's, with the starter aa_deploy.sh (INIT-107).
				variables: { BOARD_IP: "analog.local", BOARD_USER: "analog", BOARD_PASSWORD: { secret: true } },
			},
		});
	});

	test("the bare run: Ctrl-C in the setup keeps what was answered, exit 130; a settings file that isn't JSON stops it before a question, exit 2", async () => {
		write_settings({});
		const prompter = scripted([]);
		const setup_registry: Registry = { linux: () => import("./index").then(module => ({ ...module.backend, setup: create_setup({ home: base }) })) };
		const stopped = await run([], { prompter, registry: setup_registry });
		expect(stopped.code).toBe(130);
		expect(stopped.stdout).toMatch(/Stopped\. What was answered is saved; run analog-attach again to go on\.\n$/);
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toEqual({ backend: "linux", linux: {} });

		fs.writeFileSync(path.join(project, ".analog-attach", "config.json"), "{ nope");
		const broken = scripted([]);
		const result = await run([], { prompter: broken, registry: setup_registry });
		expect(result.code).toBe(2);
		expect(broken.asked).toEqual([]);
		expect(result.stderr).toContain("not JSON");

		// Nor can it save into a linux section that isn't an object: an old flat file.
		fs.writeFileSync(path.join(project, ".analog-attach", "config.json"), JSON.stringify({ backend: "linux", linux, devicetree: path.join(base, "base.dts") }));
		const flat = scripted([]);
		const refused = await run([], { prompter: flat, registry: setup_registry });
		expect(refused.code).toBe(2);
		expect(flat.asked).toEqual([]);
		expect(refused.stderr).toContain(".analog-attach/config.json: linux: must be an object");
	});

	test("build: no aa_build.sh is a refusal with the restore hint; init --restore writes it, and build runs it", async () => {
		configure();
		const missing = await run(["build"]);
		expect(missing).toMatchObject({ code: 0, stdout: `aa_build.sh not found in ${project}\n\nRun 'analog-attach init --restore build' to write the starter aa_build.sh, or set AA_BUILD to another command ('analog-attach config var AA_BUILD <command>').\n` });
		const restored = await run(["--json", "init", "--restore", "build"]);
		const script = path.join(project, "aa_build.sh");
		expect(JSON.parse(restored.stdout)).toEqual({ ok: true, message: `Wrote the starter aa_build.sh: ${script}`, severity: "info", path: script, created: true, variables: [] });
		expect(fs.statSync(script).mode & 0o777).toBe(0o755);
		const result = await run(["build"]);
		const output = path.join(project, "build", "overlay.dtbo");
		expect(result.stdout).toBe(`Build completed successfully\n\n  ${output}\n`);
		expect(result.stderr).toContain(`Building ${path.join(project, "overlay.dtso")} with AA_BUILD\n`);
		expect(fs.existsSync(output)).toBe(true);
	});

	test("build: the script gets the AA_ variables and the project's, never a secret, and a failure is refused with its stderr", async () => {
		configure();
		expect(await stdout_of(["config", "var", "BOARD_IP", "10.0.0.5"])).toBe("Set variable BOARD_IP = 10.0.0.5\n");
		expect(await stdout_of(["config", "var", "BOARD_PASSWORD", "--secret"])).toBe("Set variable BOARD_PASSWORD as a secret\n");
		fs.writeFileSync(path.join(project, "aa_build.sh"), "#!/bin/sh\necho \"$AA_PROJECT $AA_OUTPUT $AA_DTSO $AA_DTBO $BOARD_IP [$BOARD_PASSWORD] [$AA_OLD]\" > env.txt\necho broken >&2\nexit 3\n", { mode: 0o755 });
		const failed = await run(["--json", "build"], { environment: { BOARD_PASSWORD: "hunter2", AA_OLD: "inherited" } });
		expect(JSON.parse(failed.stdout)).toEqual({ ok: false, message: "Build failed: AA_BUILD exited with status 3\nbroken", severity: "error", error_type: "tool-failed" });
		expect(fs.readFileSync(path.join(project, "env.txt"), "utf8"))
			.toBe(`${project} overlay ${path.join(project, "overlay.dtso")} ${path.join(project, "build", "overlay.dtbo")} 10.0.0.5 [] []\n`);
		const text = await run(["build"]);
		expect(text.stdout).toBe("Build failed: AA_BUILD exited with status 3\n");
		expect(text.stderr).toContain("broken\n");
	});

	test("build: a script that isn't executable is refused; one that leaves no output is a warning", async () => {
		configure();
		fs.writeFileSync(path.join(project, "aa_build.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o644 });
		const plain = await run(["--json", "build"]);
		expect(JSON.parse(plain.stdout)).toMatchObject({ ok: false, error_type: "tool-missing", message: `${path.join(project, "aa_build.sh")} is not executable` });
		fs.chmodSync(path.join(project, "aa_build.sh"), 0o755);
		const empty = await run(["--json", "build"]);
		const output = path.join(project, "build", "overlay.dtbo");
		expect(JSON.parse(empty.stdout)).toEqual({ ok: true, message: `AA_BUILD succeeded, but ${output} is not there`, severity: "warn", error_type: "output-missing" });
	});

	test("deploy: a secret comes from the environment, or a terminal asks for it; piped without it, it is refused by name", async () => {
		configure();
		await run(["config", "var", "BOARD_PASSWORD", "--secret"]);
		fs.writeFileSync(path.join(project, "aa_deploy.sh"), "#!/bin/sh\necho \"$AA_DTBO $BOARD_PASSWORD\" > deployed.txt\n", { mode: 0o755 });
		const refused = await run(["--json", "deploy"]);
		expect(JSON.parse(refused.stdout)).toMatchObject({
			ok: false, error_type: "missing-setting", message: "Secret variable BOARD_PASSWORD is not in the environment",
			errors: [{ field: "BOARD_PASSWORD", kind: "missing", error_type: "missing-setting" }],
		});
		expect(fs.existsSync(path.join(project, "deployed.txt"))).toBe(false);
		const dtbo = path.join(project, "build", "overlay.dtbo");
		const given = await run(["--json", "deploy"], { environment: { BOARD_PASSWORD: "from-env" } });
		expect(JSON.parse(given.stdout)).toEqual({ ok: true, message: `Deployed ${dtbo} with AA_DEPLOY`, severity: "info" });
		expect(fs.readFileSync(path.join(project, "deployed.txt"), "utf8")).toBe(`${dtbo} from-env\n`);
		const prompter = scripted(["typed"]);
		const asked = await run(["deploy"], { prompter });
		expect(asked.stdout).toBe("Deploy completed successfully\n");
		expect(prompter.asked).toEqual(["BOARD_PASSWORD:"]);
		expect(fs.readFileSync(path.join(project, "deployed.txt"), "utf8")).toBe(`${dtbo} typed\n`);
		// Nothing of it was written.
		expect(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8")).not.toMatch(/typed|from-env/);
	});

	test("deploy: no aa_deploy.sh is a refusal, with a missing secret, together", async () => {
		configure();
		await run(["config", "var", "PASS", "--secret"]);
		const refused = await run(["--json", "deploy"]);
		const response = JSON.parse(refused.stdout) as { errors: { field: string }[]; hints: string[] };
		expect(response.errors.map(error => error.field)).toEqual(["aa_deploy.sh", "PASS"]);
		expect(response.hints[0]).toBe("Run 'analog-attach init --restore deploy' to write the starter aa_deploy.sh, or set AA_DEPLOY to another command ('analog-attach config var AA_DEPLOY <command>').");
	});

	test("config var: lists the system and project variables, shows, converts and resets one", async () => {
		configure();
		await run(["config", "var", "BOARD_IP", "10.0.0.5"]);
		const listed = await json_of(["config", "var"]) as { message: string; variables: { name: string; kind: string; value: unknown; scripts: string[] }[] };
		expect(listed.message).toBe("15 variable(s)");
		expect(listed.variables.map(variable => variable.name)).toEqual([
			"AA_PROJECT", "AA_OUTPUT", "AA_BUILD_DIR", "AA_DTSO", "AA_DTBO", "AA_DTS", "AA_DTB", "AA_DTC", "AA_LINUX", "AA_PREPROCESS_INPUT", "AA_PREPROCESS_OUTPUT",
			"AA_BUILD", "AA_DEPLOY", "AA_PREPROCESS_COMMAND", "BOARD_IP",
		]);
		expect(listed.variables.at(-1)).toEqual({ name: "BOARD_IP", kind: "project", value: "10.0.0.5", scripts: ["build", "deploy", "preprocess"] });
		expect(listed.variables.find(variable => variable.name === "AA_BUILD")).toMatchObject({ kind: "executable", value: "./aa_build.sh", default: "./aa_build.sh", runs: "build", scripts: [] });
		const all = await json_of(["config"]) as { variables: unknown[] };
		expect(all.variables).toHaveLength(15);
		expect(await stdout_of(["config", "var", "BOARD_IP", "--secret"])).toBe("Set variable BOARD_IP as a secret (its stored value removed)\n");
		const one = await json_of(["config", "var", "BOARD_IP"], { environment: { BOARD_IP: "x" } }) as { variables: unknown[] };
		expect(JSON.stringify(one.variables)).toBe(`[{"name":"BOARD_IP","kind":"secret","value":null,"scripts":["deploy"],"in_environment":true}]`);
		expect(await json_of(["config", "var", "BOARD_IP", "1.2.3.4"])).toMatchObject({ ok: false, error_type: "invalid-setting" });
		expect(await stdout_of(["config", "var", "BOARD_IP", "--reset"])).toBe("Reset variable BOARD_IP (not set)\n");
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).not.toHaveProperty("linux.variables");
		expect(await json_of(["config", "var", "AA_X", "1"])).toMatchObject({ ok: false, error_type: "invalid-name", message: "AA_X starts with AA_, the system variables' prefix" });
		expect(await json_of(["config", "var", "NOPE"])).toMatchObject({ ok: false, error_type: "not-found" });
		expect(await run(["config", "var", "X", "--global", "1"])).toMatchObject({ code: 0, stdout: "Variables belong to the project and can't be in the global settings: set them without --global\n" });
		const secret_setting = await run(["config", "workfile", "--secret"]);
		expect(secret_setting.code).toBe(2);
	});

	test("config var: an executable variable is set, shown, never a secret, and reset to its default", async () => {
		configure();
		expect(await stdout_of(["config", "var", "AA_BUILD", "make -C fw overlay"])).toBe("Set variable AA_BUILD = make -C fw overlay\n");
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toMatchObject({ linux: { variables: { AA_BUILD: "make -C fw overlay" } } });
		const shown = await stdout_of(["config", "var", "AA_BUILD"]);
		expect(shown).toContain("  Kind:         executable\n  Runs:         build\n");
		expect(shown).toContain("  Default:      ./aa_build.sh\n");
		const listed = await stdout_of(["config", "var"]);
		expect(listed).toMatch(/AA_BUILD +make -C fw overlay +executable, run by build\n/);
		expect(listed).toMatch(/AA_DEPLOY +\.\/aa_deploy\.sh +executable \(default\), run by deploy\n/);
		expect(await json_of(["config", "var", "AA_BUILD", "--secret"])).toMatchObject({ ok: false, error_type: "invalid-setting" });
		expect(await json_of(["config", "var", "AA_BUILD", " "])).toMatchObject({ ok: false, error_type: "invalid-setting", message: "AA_BUILD: must not be empty: analog-attach config var AA_BUILD --reset goes back to the default, ./aa_build.sh" });
		expect(await stdout_of(["config", "var", "AA_BUILD", "--reset"])).toBe("Reset variable AA_BUILD (default ./aa_build.sh)\n");
		expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).not.toHaveProperty("linux.variables");
		expect(await json_of(["config", "var", "AA_DTBO", "--reset"])).toMatchObject({ ok: false, error_type: "read-only" });
	});

	test("build: AA_BUILD is run with sh, in the project root, without aa_build.sh", async () => {
		configure();
		const output = path.join(project, "build", "overlay.dtbo");
		await run(["config", "var", "AA_BUILD", "mkdir -p \"$AA_BUILD_DIR\"\necho built > \"$AA_DTBO\"\necho \"$PWD\""]);
		const result = await run(["--json", "build"]);
		expect(JSON.parse(result.stdout)).toEqual({ ok: true, message: `Built ${path.join(project, "overlay.dtso")} with AA_BUILD`, severity: "info", path: output });
		expect(result.stderr).toContain(`${project}\n`);
		expect(fs.readFileSync(output, "utf8")).toBe("built\n");
		await run(["config", "var", "AA_BUILD", "exit 4"]);
		expect(await json_of(["build"])).toMatchObject({ ok: false, error_type: "tool-failed", message: "Build failed: AA_BUILD exited with status 4" });
	});

	test("AA_PREPROCESS_COMMAND preprocesses the base, with the files and the project's variables in its environment", async () => {
		configure();
		await run(["config", "var", "MARK", "from-the-project"]);
		await run(["config", "var", "AA_PREPROCESS_COMMAND", "echo \"$MARK\" > \"$AA_PROJECT/mark.txt\"\ncp \"$AA_PREPROCESS_INPUT\" \"$AA_PREPROCESS_OUTPUT\""]);
		expect(await run(["--json", "read", "/"])).toMatchObject({ code: 0 });
		expect(fs.readFileSync(path.join(project, "mark.txt"), "utf8")).toBe("from-the-project\n");
		await run(["config", "var", "AA_PREPROCESS_COMMAND", "echo nope >&2; exit 1"]);
		const failed = await json_of(["read", "/"]) as { ok: boolean; message: string };
		expect(failed).toMatchObject({ ok: false });
		expect(failed.message).toContain("preprocessing");
		expect(failed.message).toContain("nope");
	});

	test("init: writes the starters, keeps them on a re-run; --restore puts one back over an edit", async () => {
		configure();
		const first = await json_of(["init"]) as { scripts: unknown[] };
		const board = [{ name: "BOARD_IP", secret: false, value: "analog.local" }, { name: "BOARD_USER", secret: false, value: "analog" }, { name: "BOARD_PASSWORD", secret: true }];
		expect(first.scripts).toEqual([{ path: path.join(project, "aa_build.sh"), created: true, variables: [] }, { path: path.join(project, "aa_deploy.sh"), created: true, variables: board }]);
		fs.writeFileSync(path.join(project, "aa_deploy.sh"), "mine");
		await run(["config", "var", "BOARD_USER", "--reset"]);
		const second = await run(["init"]);
		expect(second.stdout).toContain(`aa_deploy.sh:  ${path.join(project, "aa_deploy.sh")} (kept)`);
		// A script kept sets nothing, not even a variable the project has lost.
		expect(second.stdout).not.toContain("Variables:");
		expect(fs.readFileSync(path.join(project, "aa_deploy.sh"), "utf8")).toBe("mine");
		const restored = await json_of(["init", "--restore", "deploy"]) as { created: boolean; variables: unknown[] };
		expect(restored.created).toBe(false);
		expect(restored.variables).toEqual([{ name: "BOARD_USER", secret: false, value: "analog" }]);
		expect(fs.readFileSync(path.join(project, "aa_deploy.sh"), "utf8")).toContain("BOARD_PASSWORD");
		expect(await json_of(["init", "--restore", "other"])).toMatchObject({ ok: false, error_type: "unknown-choice", message: "Unknown script 'other'. Restore one of: build, deploy" });
	});

	test("every command's help ends with examples (GRM-009)", async () => {
		configure();
		const routes = build_routes({ program: "analog-attach", backend, registry: {}, choices: [], home: "/home/nobody", environment: {} } as unknown as FrontEnd)
			.filter(route => route.hidden !== true);
		const missing: string[] = [];
		for (const route of routes) {
			const name = route.path.join(" ");
			const result = await run([...route.path, "--help"]);
			expect(result, name).toMatchObject({ code: 0, stderr: "" });
			if (!/\nExamples:\n {2}\$ analog-attach /.test(result.stdout)) { missing.push(name); }
		}
		expect(missing).toEqual([]);
	});
});
