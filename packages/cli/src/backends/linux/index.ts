// The Linux backend: device tree overlays for a Linux kernel tree, the commands of
// attach-linux behind the front end's grammar (see interface/backend-interface.ts): the
// shared commands, the extras only Linux has (`move`, `enable`, `disable`, `list parent`,
// `list overlay`), completion (complete.ts) and the bare run's setup.

import * as fs from "node:fs";
import path from "node:path";

import type { Backend } from "../../interface/backend-interface";
import { find_package_root } from "../../front/main";
import { complete } from "./complete";
import { linux_settings_hooks } from "./config/hooks";
import { SETTINGS } from "./config/settings";
import type { LinuxResponses } from "./protocol/types";
import { add } from "./commands/add/command";
import { build } from "./commands/build/command";
import { delete_command } from "./commands/delete/command";
import { deploy } from "./commands/deploy/command";
import { disable, enable } from "./commands/enable-disable/command";
import { import_command } from "./commands/import/command";
import { init } from "./commands/init/command";
import { list_devices } from "./commands/list/device";
import { list_overlay } from "./commands/list/overlay";
import { list_parent } from "./commands/list/placement";
import { list_property } from "./commands/list/property";
import { list_value } from "./commands/list/value";
import { move } from "./commands/move/command";
import { read } from "./commands/read/command";
import { rename } from "./commands/rename/command";
import { setup } from "./commands/setup/command";
import { update } from "./commands/update/command";
import { validate } from "./commands/validate/command";

const package_root = find_package_root();

function package_version(): string {
    const { version } = JSON.parse(fs.readFileSync(path.join(package_root, "package.json"), "utf8")) as { version?: string };
    return version ?? "0.0.0";
}

export const backend: Backend<LinuxResponses> = {
    id: "linux",
    title: "Linux device tree overlays",
    version: package_version(),
    words: { device: "compatible", path: "path", workfile: "overlay" },
    settings: SETTINGS,
    settings_hooks: linux_settings_hooks,
    commands: {
        init,
        list: { devices: list_devices, property: list_property, value: list_value },
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
    extra: {
        move,
        enable,
        disable,
        "list parent": list_parent,
        "list overlay": list_overlay,
    },
    setup,
    skills: [{ name: "analog-attach-linux", about: "Linux device tree overlays", source_dir: path.join(package_root, "skills", "linux") }],
    complete,
};
