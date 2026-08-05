import { buildApplication, buildRouteMap } from "@stricli/core";
import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";
import { name, version, description } from "../package.json";
import { list_devices_command } from "./commands/list-devices/command";
import { get_schema_command } from "./commands/get-schema/command";
import { suggest_parents_command } from "./commands/suggest-parents/command";
import { create_command } from "./commands/create/command";
import { add_command } from "./commands/add/command";
import { validate_command } from "./commands/validate/command";
import { get_property_command } from "./commands/get-prop/command";
import { set_property_command } from "./commands/set-prop/command";
import { unset_property_command } from "./commands/unset-prop/command";
import { enable_command, disable_command } from "./commands/enable-disable/command";
import { install_skill_command } from "./commands/skill/install-skill";
import { uninstall_skill_command } from "./commands/skill/uninstall-skill";
import { init_command } from "./commands/init/command";
import { delete_command } from "./commands/delete/command";
import { rename_command } from "./commands/rename/command";
import { move_command } from "./commands/move/command";

const routes = buildRouteMap({
    routes: {
        init: init_command,
        delete: delete_command,
        rename: rename_command,
        move: move_command,
        listDevices: list_devices_command,
        getSchema: get_schema_command,
        suggestParents: suggest_parents_command,
        create: create_command,
        add: add_command,
        validate: validate_command,
        getProp: get_property_command,
        setProp: set_property_command,
        unsetProp: unset_property_command,
        enable: enable_command,
        disable: disable_command,
        installSkill: install_skill_command,
        uninstallSkill: uninstall_skill_command,
        install: buildInstallCommand("attach", { bash: "__attach_bash_complete" }),
        uninstall: buildUninstallCommand("attach", { bash: true }),
    },
    docs: {
        brief: description,
        hideRoute: {
            install: true,
            uninstall: true,
        },
    },
});

export const app = buildApplication(routes, {
    name,
    versionInfo: {
        currentVersion: version,
    },
    scanner: {
        caseStyle: "allow-kebab-for-camel"
    }
});
