import { buildApplication, buildRouteMap } from "@stricli/core";
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

import { attach_manifest_command } from "./commands/attach-manifest/command";
import { config_get_command } from "./commands/config-get/command";
import { config_set_command } from "./commands/config-set/command";
import { create_workfile_command } from "./commands/create-workfile/command";
import { read_command } from "./commands/read/command";
import { update_command } from "./commands/update/command";
import { list_intelligence_command } from "./commands/list-intelligence/command";
import { suggest_command } from "./commands/suggest/command";
import { completion_command } from "./commands/completion/command";

const routes = buildRouteMap({
    routes: {
        // protocol commands
        attachManifest: attach_manifest_command,
        configGet: config_get_command,
        configSet: config_set_command,
        createWorkfile: create_workfile_command,
        listDevices: list_devices_command,
        add: add_command,
        read: read_command,
        update: update_command,
        delete: delete_command,
        validate: validate_command,
        move: move_command,
        rename: rename_command,
        listIntelligence: list_intelligence_command,
        suggest: suggest_command,

        // human-only commands (not in manifest)
        init: init_command,
        create: create_command,
        getSchema: get_schema_command,
        suggestParents: suggest_parents_command,
        getProp: get_property_command,
        setProp: set_property_command,
        unsetProp: unset_property_command,
        enable: enable_command,
        disable: disable_command,

        // skill + completion management
        installSkill: install_skill_command,
        uninstallSkill: uninstall_skill_command,
        completion: completion_command,
    },
    docs: {
        brief: description,
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
