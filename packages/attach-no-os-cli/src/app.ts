import { buildApplication, buildRouteMap } from "@stricli/core";
import { configCommand } from "./commands/config";
import { createCommand } from "./commands/create";
import { readCommand } from "./commands/read";
import { updateCommand } from "./commands/update";
import { deleteCommand } from "./commands/delete";
import { validateCommand } from "./commands/validate";
import { generateCommand } from "./commands/generate";
import { buildCommandDefinition } from "./commands/build";
import { deployCommand } from "./commands/deploy";

const routes = buildRouteMap({
	routes: {
		config: configCommand,
		create: createCommand,
		read: readCommand,
		update: updateCommand,
		delete: deleteCommand,
		validate: validateCommand,
		generate: generateCommand,
		build: buildCommandDefinition,
		deploy: deployCommand,
	},
	docs: {
		brief: "Analog Attach CLI for no-OS workfiles",
	},
});

export const app = buildApplication(routes, {
	name: "aa",
	versionInfo: {
		currentVersion: "0.1.0",
	}
});
