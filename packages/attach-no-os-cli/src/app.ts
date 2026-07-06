import { buildApplication, buildRouteMap } from "@stricli/core";
import { configCommand } from "./commands/config";
import { createCommand } from "./commands/create";
import { readCommand } from "./commands/read";

const routes = buildRouteMap({
	routes: {
		config: configCommand,
		create: createCommand,
		read: readCommand
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
