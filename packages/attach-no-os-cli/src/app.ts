import { buildApplication, buildRouteMap } from "@stricli/core";
import { configCommand } from "./commands/config";
import { createCommand } from "./commands/create";
import { readCommand } from "./commands/read";
import { updateCommand } from "./commands/update";
import { deleteCommand } from "./commands/delete";

const routes = buildRouteMap({
	routes: {
		config: configCommand,
		create: createCommand,
		read: readCommand,
		update: updateCommand,
		delete: deleteCommand,
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
