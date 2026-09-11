import { buildApplication, buildRouteMap } from "@stricli/core";
import { addCommand } from "./commands/add";
import { attachManifestCommand } from "./commands/attach_manifest";
import { buildCommandDefinition } from "./commands/build";
import { completionCommand } from "./commands/completion";
import { toolConfigGetCommand, toolConfigSetCommand } from "./commands/config";
import { createWorkfileCommand } from "./commands/create_workfile";
import { deleteCommand } from "./commands/delete";
import { deployCommand } from "./commands/deploy";
import { generateCommand } from "./commands/generate";
import { listIntelligenceCommand, suggestCommand } from "./commands/intelligence";
import { listBoardsCommand, listPlatformsCommand } from "./commands/list";
import { listDevicesCommand } from "./commands/list_devices";
import { moveCommand } from "./commands/move";
import { readCommand } from "./commands/read";
import { renameCommand } from "./commands/rename";
import { updateCommand } from "./commands/update";
import { validateCommand } from "./commands/validate";
import { TOOL_DESCRIPTION, TOOL_VERSION } from "./protocol/manifest";

/**
 * One route per protocol command, spelled exactly as the protocol spells it.
 *
 * There is no separate machine interface: attach-meta invokes these same routes with
 * `--json` appended (that is all its manifest entry adds), so a person and attach-meta walk
 * the same commands and see the same behaviour in two renderings.
 *
 * `list-boards`, `list-platforms` and `completion` are ours alone — attach-meta has no
 * command that means either — and `attach-manifest` is the one fixed name it requires.
 */
const routes = buildRouteMap({
	routes: {
		"attach-manifest": attachManifestCommand,
		"tool-config-get": toolConfigGetCommand,
		"tool-config-set": toolConfigSetCommand,
		"create-workfile": createWorkfileCommand,
		"list-devices": listDevicesCommand,
		add: addCommand,
		read: readCommand,
		update: updateCommand,
		delete: deleteCommand,
		rename: renameCommand,
		move: moveCommand,
		validate: validateCommand,
		generate: generateCommand,
		build: buildCommandDefinition,
		deploy: deployCommand,
		"list-intelligence": listIntelligenceCommand,
		suggest: suggestCommand,
		"list-boards": listBoardsCommand,
		"list-platforms": listPlatformsCommand,
		completion: completionCommand,
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
