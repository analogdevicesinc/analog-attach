import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs";
import path from "node:path";
import {
	create_workfile,
	export_minimal,
	get_schemas_path,
	import_minimal,
	list_available_structs,
	load_minimal_workfile,
	ok,
	error,
	Result,
	scan_platforms,
	AvailableStructs,
	Workfile,
	add_symbol,
	load_resolved_ruleset
} from "attach-no-os-lib";

type CreateWorkfileNoPlatform = {
	available_platforms: {
		name: string;
		description: string;
	}[];
};

const DISPLAY_MAX_IDS = 5;

function resolve_workfile_path(path?: string): string | undefined {
	if (!path) {
		return "./workfile.json";
	}

	// Path ends with / or is an existing directory
	if (path.endsWith("/") || (fs.existsSync(path) && fs.statSync(path).isDirectory())) {
		return path.endsWith("/") ? `${path}workfile.json` : `${path}/workfile.json`;
	}

	// Custom filename provided - not supported
	return undefined;
}

function list_available_platforms(): Result<CreateWorkfileNoPlatform> {
	const schemas_path = get_schemas_path();
	if (!schemas_path.ok) {
		return schemas_path;
	}

	const platforms_path = path.join(schemas_path.value, "platforms");
	const result = scan_platforms(platforms_path);

	if (!result.ok) {
		return result;
	}

	// TODO: Tackle descriptions
	return ok({
		available_platforms: Object.keys(result.value).map(name => ({ name, description: "no description yet" }))
	});
}

function format_no_platform(data: CreateWorkfileNoPlatform): string {
	let out = "No platform specified. Available platforms:\n\n";
	for (const p of data.available_platforms) {
		out += `  ${p.name.padEnd(14)}${p.description}\n`;
	}
	out += "\nUse: aa create workfile --platform <name>";
	return out;
}

const createWorkfileCommand = buildCommand<
{ platform?: string; json?: boolean },
[string | undefined]  // workfile path
>({
	docs: { brief: "Create a new workfile" },
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [
				{ placeholder: "workfile", brief: "Path for new workfile", optional: true, parse: String }
			]
		},
		flags: {
			platform: { kind: "parsed", brief: "Target platform", optional: true, parse: String },
			json: { kind: "boolean", brief: "Output as JSON", optional: true }
		}
	},
	func: async (flags, path) => {
		const platforms = list_available_platforms();
		if (!platforms.ok) {
			if (flags.json) {
				console.log(JSON.stringify({ error: "cannot_list_platforms", message: platforms.error }, undefined, 2));
			} else {
				console.log(platforms.error);
			}
			return;
		}

		if (!flags.platform) {
			if (flags.json) {
				console.log(JSON.stringify(platforms.value, undefined, 2));
			} else {
				console.log(format_no_platform(platforms.value));
			}
			return;
		}

		const match = platforms.value.available_platforms.find(p => p.name === flags.platform);
		if (!match) {
			const message = `Platform ${flags.platform} does not match the available platforms: ${platforms.value.available_platforms.map(p => p.name).join(", ")}`;
			if (flags.json) {
				console.log(JSON.stringify({ error: "platform_mismatch", message: message }));
			} else {
				console.log(message);
			}
			return;
		}

		const workfile = create_workfile(flags.platform);
		if (!workfile.ok) {
			if (flags.json) {
				console.log(workfile, undefined, 2);
			} else {
				console.log(workfile.error);
			}
			return;
		}

		const minimal_workfile = export_minimal(workfile.value);	
		if (!minimal_workfile.ok) {
			if (flags.json) {
				console.log(minimal_workfile, undefined, 2);
			} else {
				console.log(minimal_workfile.error);
			}
			return;
		}

		const workfile_path = resolve_workfile_path(path);

		if (!workfile_path) {
			const message = "Custom workfile name not supported yet. Use a directory path or omit the path (current directory selected)";
			if (flags.json) {
				console.log(JSON.stringify({ error: "custom_filename_not_supported", message: message }));
			} else {
				console.log(message);
			}
			return;
		}

		fs.writeFileSync(workfile_path, JSON.stringify(minimal_workfile.value, undefined, 2));
		const message = `${workfile_path} created successfully.`;
		if (flags.json) {
			console.log(JSON.stringify({ ok: true, message: message }, undefined, 2));
		} else {
			console.log(message);
		}
	}
});


function get_available_structs(): Result<AvailableStructs & { selected_platform: string, workfile: Workfile }> {
	const workfile_path = resolve_workfile_path();
	if (workfile_path === undefined) {
		// TODO : maybe add a flag to specify the workfile path
		const message = "Cannot find workfile in the current directory. Please run this command in the workfile directory or create a workfile using the 'create workfile' command";
		return error(message);
	}

	const minimal_workfile = load_minimal_workfile(workfile_path);
	if (!minimal_workfile.ok) {
		return minimal_workfile;
	}

	const workfile = import_minimal(minimal_workfile.value);
	if (!workfile.ok) {
		// console.log(workfile);
		return workfile;
	}

	const available_structs = list_available_structs(workfile.value);
	if (!available_structs.ok) {
		return available_structs;
	}

	return ok({
		...available_structs.value,
		selected_platform: minimal_workfile.value.platform,
		workfile: workfile.value
	});
}

function format_available_structs(structs: AvailableStructs, platform?: string): string {
	let out = "Available schemas:\n\n";

	const format_section = (title: string, items: string[]) => {
		out += `  ${title}:\n`;
		const show = items.slice(0, DISPLAY_MAX_IDS);
		if (show.length === 0) {
			out += `	(none)\n\n`;
			return;
		}
		for (const item of show) {
			out += `    ${item}\n`;
		}
		if (items.length > DISPLAY_MAX_IDS) {
			out += `    ... (${items.length - DISPLAY_MAX_IDS} more)\n`;
		}
		out += "\n";
	};

	format_section("Devices", structs.devices);
	format_section("No-OS", structs.noos);
	format_section(`Platform${platform ? ` (${platform})` : ""}`, structs.platform);

	out += "Use: aa create node <name> <schema>\n";
	out += "Filter: aa create node --filter <term>";

	return out;
}

const createNodeCommand = buildCommand<
{ json?: boolean; filter?: string },
[string | undefined, string | undefined]  // name, schema
>({
	docs: { brief: "Create a new node" },
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [
				{ placeholder: "name", brief: "Node name", optional: true, parse: String },
				{ placeholder: "schema", brief: "Schema path", optional: true, parse: String }
			]
		},
		flags: {
			filter: { kind: "parsed", brief: "Filter available schemas", optional: true, parse: String },
			json: { kind: "boolean", brief: "Output as JSON", optional: true },
		}
	},
	func: async (flags, name, schema) => {
		if (!schema) {
			if (flags.filter === undefined) {
				// Display mini help and some functionalities
				const available_structs = get_available_structs();
				if (!available_structs.ok) {
					if (flags.json) {
						console.log(JSON.stringify(available_structs, undefined, 2));
					} else {
						console.log(available_structs.error);
					}
					return;
				}

				if (flags.json) {
					console.log(JSON.stringify(available_structs.value, undefined, 2));
				} else {
					const output = format_available_structs(
						available_structs.value,
						available_structs.value.selected_platform
					);
					console.log(output);
				}
			} else {
				// normal filter
				const available_structs = get_available_structs();
				if (!available_structs.ok) {
					if (flags.json) {
						console.log(JSON.stringify(available_structs, undefined, 2));
					} else {
						console.log(available_structs.error);
					}
					return;
				}

				if (flags.json) {
					console.log(JSON.stringify(available_structs.value, undefined, 2));
				} else {
					let noos = available_structs.value.noos.filter(id => id.includes(flags.filter));
					let devices = available_structs.value.devices.filter(id => id.includes(flags.filter));
					let platform = available_structs.value.platform.filter(id => id.includes(flags.filter));

					const output = format_available_structs(
						{ noos, devices, platform },
						available_structs.value.selected_platform
					);
					console.log(output);
				}
			}
		}

		if (name && schema) {
			if (flags.filter) {
				const message = "Cannot use the --filter flag when specifying a name and ruleset";
				if (flags.json) {
					console.log(JSON.stringify({ message }, undefined, 2));
				} else {
					console.log(message);
				}
			} else {
				// actual node creation

				// FIXME: atp return everything from get_available_structs
				const workfile_path = resolve_workfile_path();
				if (workfile_path === undefined) {
					// TODO : maybe add a flag to specify the workfile path
					const message = "Cannot find workfile in the current directory. Please run this command in the workfile directory or create a workfile using the 'create workfile' command";
					if (flags.json) {
						console.log(JSON.stringify({ message: message }, undefined, 2));
					} else {
						console.log(message);
					}
					return;
				}

				const available_structs = get_available_structs();
				if (!available_structs.ok) {
					if (flags.json) {
						console.log(JSON.stringify(available_structs, undefined, 2));
					} else {
						console.log(available_structs.error.message);
					}
					return;
				}

				if (
					!available_structs.value.noos.includes(schema) &&
					!available_structs.value.devices.includes(schema) &&
				!available_structs.value.platform.includes(schema)
				) {
					const message = `Unknown schema "${schema}", please check the list again`;
					if (flags.json) {
						console.log(JSON.stringify({ ok: false, error: message }, undefined, 2));
					} else {
						console.log(message);
					}
					return;
				}

				const ruleset = load_resolved_ruleset(schema);
				if (!ruleset.ok) {
					if (flags.json) {
						console.log(JSON.stringify(ruleset, undefined, 2));
					} else {
						console.log(ruleset.error.message);
					}
					return;
				}

				const changed_workfile = add_symbol(available_structs.value.workfile, name, ruleset.value);
				if (!changed_workfile.ok) {
					if (flags.json) {
						console.log(JSON.stringify(changed_workfile, undefined, 2));
					} else {
						console.log(changed_workfile.error.message);
					}
					return;
				}

				const minimal = export_minimal(changed_workfile.value);
				if (!minimal.ok) {
					if (flags.json) {
						console.log(JSON.stringify(minimal, undefined, 2));
					} else {
						console.log(minimal.error.message);
					}
					return;
				}

				fs.writeFileSync(workfile_path, JSON.stringify(minimal.value, undefined, 2));
				const message = `${name} symbol created successfully to ${workfile_path}.`;
				if (flags.json) {
					console.log(JSON.stringify({ ok: true, message: message }, undefined, 2));
				} else {
					console.log(message);
				}
			}
		}
	}
});

export const createCommand = buildRouteMap({
	routes: {
		workfile: createWorkfileCommand,
		node: createNodeCommand,
	},
	docs: {
		brief: "Create workfile or node",
	},
});
