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
import { completionCommand } from "./commands/completion";
import { discoveryCommand } from "./commands/discovery";
import { TOOL_DESCRIPTION, TOOL_VERSION } from "./protocol";

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
		completion: completionCommand,
		discovery: discoveryCommand,
	},
	docs: {
		brief: TOOL_DESCRIPTION,
	},
});

export const app = buildApplication(routes, {
	name: "aa",
	versionInfo: {
		currentVersion: TOOL_VERSION,
	},
	// Multi-word flags are camelCase in the command definitions (stricli derives the
	// flag name from the key), but the conventional CLI spelling is kebab-case. This
	// accepts both — `--template-set` and `--templateSet` — and prints the kebab form
	// in help. Single-word flags (--json, --output) are unaffected.
	scanner: {
		caseStyle: "allow-kebab-for-camel",
	}
});
