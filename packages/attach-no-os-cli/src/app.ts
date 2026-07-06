import { buildApplication, buildRouteMap } from "@stricli/core";
import { configCommand } from "./commands/config";
import { createCommand } from "./commands/create";

const routes = buildRouteMap({
	routes: {
		config: configCommand,
		create: createCommand
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
