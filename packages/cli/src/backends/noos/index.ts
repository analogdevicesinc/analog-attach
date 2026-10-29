// The no-OS backend: CAPI projects for a board, the commands of attach-noos behind the
// front end's grammar (see interface/backend-interface.ts): the shared commands, `generate`
// (the one extra), completion (complete.ts) and the bare run's setup. Its settings are read
// by attach-no-os-lib through the session's view (settings.ts, `install`).

import * as fs from "node:fs";
import path from "node:path";

import type { Backend } from "../../interface/backend-interface";
import { find_package_root } from "../../front/main";
import { complete } from "./complete";
import { add } from "./commands/add";
import { build } from "./commands/build";
import { delete_command } from "./commands/delete";
import { deploy } from "./commands/deploy";
import { generate } from "./commands/generate";
import { import_command } from "./commands/import";
import { init } from "./commands/init";
import { list_context, list_property, list_value } from "./commands/list";
import { list_devices } from "./commands/list_devices";
import { read } from "./commands/read";
import { rename } from "./commands/rename";
import { setup } from "./commands/setup";
import { update } from "./commands/update";
import { validate } from "./commands/validate";
import type { NoosResponses } from "./protocol/responses";
import { SETTINGS, noos_settings_hooks } from "./settings";

const package_root = find_package_root();

function package_version(): string {
    const { version } = JSON.parse(fs.readFileSync(path.join(package_root, "package.json"), "utf8")) as { version?: string };
    return version ?? "0.0.0";
}

export const backend: Backend<NoosResponses> = {
    id: "noos",
    title: "no-OS CAPI projects",
    version: package_version(),
    words: { device: "schema", path: "node", workfile: "workfile" },
    settings: SETTINGS,
    settings_hooks: noos_settings_hooks,
    commands: {
        init,
        list: { devices: list_devices, context: list_context, property: list_property, value: list_value },
        add,
        import: import_command,
        read,
        update,
        delete: delete_command,
        rename,
        validate,
        build,
        deploy,
    },
    extra: { generate },
    setup,
    skills: [{ name: "analog-attach-noos", about: "CAPI projects for no-OS drivers", source_dir: path.join(package_root, "skills", "noos") }],
    complete,
};
