import { buildApplication, buildRouteMap } from "@stricli/core";
import { addCommand } from "./commands/add";
import { buildCommandDefinition } from "./commands/build";
import { completionCommand } from "./commands/completion";
import { configCommand } from "./commands/config";
import { initCommand } from "./commands/init";
import { deleteCommand } from "./commands/delete";
import { deployCommand } from "./commands/deploy";
import { generateCommand } from "./commands/generate";
import { importCommand } from "./commands/import";
import { listRoutes } from "./commands/list";
import { readCommand } from "./commands/read";
import { renameCommand } from "./commands/rename";
import { updateCommand } from "./commands/update";
import { validateCommand } from "./commands/validate";
import { TOOL_DESCRIPTION, TOOL_VERSION } from "./tool";

/**
 * Every command, by the name a person types. Each one prints text by default and JSON with
 * `--json`, from the same code path.
 */
const routes = buildRouteMap({
	routes: {
		config: configCommand,
		init: initCommand,
		list: listRoutes,
		add: addCommand,
		import: importCommand,
		read: readCommand,
		update: updateCommand,
		delete: deleteCommand,
		rename: renameCommand,
		validate: validateCommand,
		generate: generateCommand,
		build: buildCommandDefinition,
		deploy: deployCommand,
		completion: completionCommand,
	},
	docs: {
		brief: TOOL_DESCRIPTION,
	},
});

export const app = buildApplication(routes, {
	name: "attach-noos",
	versionInfo: {
		currentVersion: TOOL_VERSION,
	},
	// Multi-word flags are camelCase in the command definitions (stricli derives the
	// flag name from the key), but the conventional CLI spelling is kebab-case. This
	// accepts both — `--some-flag` and `--someFlag` — and prints the kebab form
	// in help. Single-word flags (--json, --output) are unaffected.
	scanner: {
		caseStyle: "allow-kebab-for-camel",
	}
});
